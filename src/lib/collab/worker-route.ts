import { parseCollabDocKey } from "./doc-key";
import {
  COLLAB_INTERNAL_HEADER_ISSUED,
  COLLAB_INTERNAL_HEADER_KEY,
  COLLAB_INTERNAL_HEADER_LEASE,
  COLLAB_INTERNAL_HEADER_LIFECYCLE,
  COLLAB_INTERNAL_HEADER_MODE,
  COLLAB_INTERNAL_HEADER_USER,
  COLLAB_ROOM_CLOSE_URL,
  COLLAB_ROOM_CONNECT_URL,
  COLLAB_ROOM_EPOCH_URL,
  COLLAB_ROOM_NOTIFY_URL,
  COLLAB_ROOM_RESET_URL,
  COLLAB_ROOM_RESTORE_ABORT_URL,
  COLLAB_ROOM_RESTORE_APPLY_URL,
  COLLAB_ROOM_RESTORE_BEGIN_URL,
  COLLAB_ROOM_RESTORE_HOLD_URL,
  COLLAB_ROOM_SET_META_URL,
  COLLAB_SUBPROTOCOL,
  COLLAB_WS_PATH_PREFIX,
} from "./protocol";
import { verifyCollabToken } from "./token";

/**
 * worker.ts가 OpenNext보다 먼저 부르는 공동 편집 WebSocket 경로.
 * 토큰은 URL이 아닌 `Sec-WebSocket-Protocol`(`portal-collab`, `<token>`)로 받아 요청 log에 남기지 않는다.
 */

type DurableObjectStubLike = { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
export type CollabRoomNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
};

export type CollabWorkerEnv = {
  DOC_ROOMS?: CollabRoomNamespace;
  AUTH_SECRET?: string;
};

function reject(status: number, message: string): Response {
  return new Response(message, { status, headers: { "cache-control": "no-store" } });
}

export function isCollabWebSocketRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith(COLLAB_WS_PATH_PREFIX);
}

export function readCollabSubprotocolToken(request: Request): string | null {
  const header = request.headers.get("Sec-WebSocket-Protocol");
  if (!header) return null;
  const protocols = header.split(",").map((value) => value.trim()).filter(Boolean);
  if (protocols.length !== 2 || protocols[0] !== COLLAB_SUBPROTOCOL) return null;
  return protocols[1];
}

export async function handleCollabWebSocket(
  request: Request,
  env: CollabWorkerEnv,
  nowMs: number = Date.now(),
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return reject(426, "Expected WebSocket");
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return reject(403, "Forbidden");
  if (!env.DOC_ROOMS || !env.AUTH_SECRET) return reject(503, "Collaboration unavailable");

  let rawKey: string;
  try {
    rawKey = decodeURIComponent(url.pathname.slice(COLLAB_WS_PATH_PREFIX.length));
  } catch {
    return reject(400, "Bad key");
  }
  if (!parseCollabDocKey(rawKey)) return reject(400, "Bad key");
  const token = readCollabSubprotocolToken(request);
  if (!token) return reject(401, "Unauthorized");
  const claims = await verifyCollabToken(token, rawKey, env.AUTH_SECRET, nowMs);
  if (!claims) return reject(401, "Unauthorized");

  // 클라이언트 header는 Upgrade 관련만 남기고 버린다. 내부 header는 검증된 claims로만 채운다.
  const headers = new Headers();
  for (const name of ["Upgrade", "Connection", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set(COLLAB_INTERNAL_HEADER_USER, claims.u);
  headers.set(COLLAB_INTERNAL_HEADER_MODE, claims.m);
  headers.set(COLLAB_INTERNAL_HEADER_KEY, claims.k);
  headers.set(COLLAB_INTERNAL_HEADER_LEASE, String(claims.l));
  headers.set(COLLAB_INTERNAL_HEADER_ISSUED, String(claims.i));
  if (typeof claims.e === "number") headers.set(COLLAB_INTERNAL_HEADER_LIFECYCLE, String(claims.e));
  const stub = env.DOC_ROOMS.get(env.DOC_ROOMS.idFromName(claims.k));
  // room이 101 응답에 `Sec-WebSocket-Protocol: portal-collab`을 붙인다.
  return stub.fetch(new Request(COLLAB_ROOM_CONNECT_URL, { method: "GET", headers }));
}

/** server action이 복원·휴지통 이동 뒤 room을 비울 때 쓴다. binding이 없으면(next dev) 아무것도 하지 않는다. */
export async function resetCollabRoom(env: CollabWorkerEnv | undefined, key: string): Promise<boolean> {
  if (!env?.DOC_ROOMS) return false;
  const stub = env.DOC_ROOMS.get(env.DOC_ROOMS.idFromName(key));
  const response = await stub.fetch(COLLAB_ROOM_RESET_URL, { method: "POST" });
  return response.ok;
}

/** room의 지금 epoch. binding이 없으면 null(확인하지 않음). */
export async function readCollabRoomEpoch(env: CollabWorkerEnv | undefined, key: string): Promise<number | null> {
  if (!env?.DOC_ROOMS) return null;
  const stub = env.DOC_ROOMS.get(env.DOC_ROOMS.idFromName(key));
  const response = await stub.fetch(COLLAB_ROOM_EPOCH_URL, { method: "GET" });
  if (!response.ok) throw new Error("COLLAB_ROOM_EPOCH_UNAVAILABLE");
  const body = (await response.json()) as { epoch?: unknown };
  return typeof body.epoch === "number" ? body.epoch : null;
}

function roomStub(env: CollabWorkerEnv | undefined, key: string): DurableObjectStubLike | null {
  if (!env?.DOC_ROOMS) return null;
  return env.DOC_ROOMS.get(env.DOC_ROOMS.idFromName(key));
}

async function postRoom(env: CollabWorkerEnv | undefined, key: string, url: string, body: unknown): Promise<Response | null> {
  const stub = roomStub(env, key);
  if (!stub) return null;
  return stub.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export type CollabRoomRestoreBegin =
  | { ok: true; state: string; clean: boolean; seeded: boolean; lifecycle: number }
  | { ok: false; reason: "busy" };
export type CollabRoomRestoreHold =
  | { ok: true; state: string; base: string | null; lifecycle: number; seeded: boolean }
  | { ok: false; reason: "busy" };
export type CollabRoomRestoreApply = { ok: true; applied: boolean; lifecycle: number } | { ok: false; reason: "expired" };

async function postRoomJson<T>(env: CollabWorkerEnv | undefined, key: string, url: string, body: unknown): Promise<T | null> {
  const response = await postRoom(env, key, url, body);
  if (!response) return null;
  if (!response.ok) throw new Error(`COLLAB_ROOM_${response.status}`);
  return (await response.json()) as T;
}

/** 복원 준비: room이 지금 상태를 기준으로 남기고 돌려준다. binding이 없으면 null. */
export function beginCollabRoomRestore(env: CollabWorkerEnv | undefined, key: string, id: string) {
  return postRoomJson<CollabRoomRestoreBegin>(env, key, COLLAB_ROOM_RESTORE_BEGIN_URL, { id });
}

export function holdCollabRoomRestore(env: CollabWorkerEnv | undefined, key: string, id: string) {
  return postRoomJson<CollabRoomRestoreHold>(env, key, COLLAB_ROOM_RESTORE_HOLD_URL, { id });
}

export function applyCollabRoomRestore(env: CollabWorkerEnv | undefined, key: string, input: { id: string; target: number; update: string }) {
  return postRoomJson<CollabRoomRestoreApply>(env, key, COLLAB_ROOM_RESTORE_APPLY_URL, input);
}

export async function abortCollabRoomRestore(env: CollabWorkerEnv | undefined, key: string, id: string): Promise<void> {
  await postRoom(env, key, COLLAB_ROOM_RESTORE_ABORT_URL, { id });
}

/** 연결을 모두 닫는다. keep이면 room 상태를 보존한다(휴지통). */
export async function closeCollabRoom(env: CollabWorkerEnv | undefined, key: string, keep: boolean): Promise<boolean> {
  const response = await postRoom(env, key, COLLAB_ROOM_CLOSE_URL, { keep });
  return Boolean(response?.ok);
}

export async function setCollabRoomMeta(
  env: CollabWorkerEnv | undefined,
  key: string,
  field: string,
  value: string,
  epoch?: number,
  version?: number,
): Promise<boolean> {
  const response = await postRoom(env, key, COLLAB_ROOM_SET_META_URL, {
    field,
    value,
    ...(typeof epoch === "number" ? { epoch } : {}),
    ...(typeof version === "number" ? { version } : {}),
  });
  return Boolean(response?.ok);
}

export async function notifyCollabRoom(env: CollabWorkerEnv | undefined, key: string): Promise<boolean> {
  const response = await postRoom(env, key, COLLAB_ROOM_NOTIFY_URL, {});
  return Boolean(response?.ok);
}
