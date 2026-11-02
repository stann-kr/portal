import { authorizeCollabRequest, type CollabActor, type CollabDocumentLoaders } from "./authorize";
import { COLLAB_TOKEN_TTL_SECONDS, COLLAB_WS_PATH_PREFIX } from "./protocol";
import { signCollabToken } from "./token";

/**
 * `POST /api/collab/token` 처리. 세션·문서 권한을 확인한 뒤 짧은 연결 토큰을 준다.
 * 공동 편집 binding이 없는 환경(next dev)은 `{ collab: false }`로 혼자 모드를 알린다.
 */
/** 커서에 보일 이름과 색을 정하는 본인 정보. */
export type CollabIdentity = { userId: string; displayName: string };

export type CollabTokenResponse =
  | ({ collab: true; key: string; mode: "read" | "write"; token: string; path: string; expiresIn: number } & CollabIdentity)
  | ({ collab: false; key: string; mode: "read" | "write" } & CollabIdentity);

export type CollabTokenHandlerDeps = {
  getActor(): Promise<(CollabActor & { displayName: string }) | null>;
  loaders: CollabDocumentLoaders;
  getSecret(): string | undefined;
  isCollabAvailable(): boolean;
  /**
   * 권한 확인 뒤, room이 D1 lifecycle보다 뒤처졌으면(복원 commit 뒤 room 적용 전에 action이 끝남) 같은 문서에 복원을 다시 적용한다.
   * 실패해도 토큰은 준다(옛 lifecycle 저장은 거부되고 다음 발급이 다시 시도한다).
   */
  repairRoom?(key: string, lifecycle: number): Promise<void>;
};

const MAX_BODY_BYTES = 4096;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function createCollabTokenHandler(deps: CollabTokenHandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const actor = await deps.getActor();
    if (!actor) return json({ error: "UNAUTHORIZED" }, 401);
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "FORBIDDEN" }, 403);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "BAD_REQUEST" }, 400);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "BAD_REQUEST" }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "BAD_REQUEST" }, 400);
    const { key, createNote } = body as { key?: unknown; createNote?: unknown };
    const result = await authorizeCollabRequest(actor, { key, createNote }, deps.loaders);
    if (!result.ok) {
      if (result.reason === "BAD_REQUEST") return json({ error: "BAD_REQUEST" }, 400);
      // 휴지통: 열린 편집기는 그 자리에서 기다렸다가 되살리면 같은 문서로 다시 붙는다.
      if (result.reason === "TRASHED") return json({ error: "TRASHED" }, 410);
      return json({ error: "NOT_FOUND_OR_FORBIDDEN" }, 403);
    }
    const secret = deps.getSecret();
    if (!deps.isCollabAvailable() || !secret) {
      const response: CollabTokenResponse = {
        collab: false,
        key: result.key,
        mode: result.mode,
        userId: actor.id,
        displayName: actor.displayName,
      };
      return json(response, 200);
    }
    if (typeof result.lifecycle === "number" && result.lifecycle > 0 && deps.repairRoom) {
      await deps.repairRoom(result.key, result.lifecycle).catch(() => undefined);
    }
    const token = await signCollabToken(
      { key: result.key, userId: actor.id, mode: result.mode, lifecycle: result.lifecycle },
      secret,
    );
    const response: CollabTokenResponse = {
      collab: true,
      key: result.key,
      mode: result.mode,
      token,
      path: `${COLLAB_WS_PATH_PREFIX}${encodeURIComponent(result.key)}`,
      expiresIn: COLLAB_TOKEN_TTL_SECONDS,
      userId: actor.id,
      displayName: actor.displayName,
    };
    return json(response, 200);
  };
}
