import assert from "node:assert/strict";
import test, { after } from "node:test";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { deriveCreationResourceId } from "@/lib/creation-operation";
import { authorizeCollabRequest, type CollabDocumentLoaders } from "./authorize";
import { formatCollabDocKey, parseCollabDocKey } from "./doc-key";
import {
  COLLAB_CLOSE_EXPIRED,
  COLLAB_CLOSE_RESET,
  COLLAB_CLOSE_TOO_LARGE,
  COLLAB_INTERNAL_HEADER_KEY,
  COLLAB_INTERNAL_HEADER_MODE,
  COLLAB_INTERNAL_HEADER_USER,
  COLLAB_MAX_MESSAGE_BYTES,
  COLLAB_MESSAGE_AWARENESS,
  COLLAB_MESSAGE_CONTROL,
  COLLAB_MESSAGE_SYNC,
  COLLAB_SOCKET_MAX_AGE_MS,
  COLLAB_EPOCH_FIELD,
  COLLAB_SUBPROTOCOL,
} from "./protocol";
import { isStaleCollabSave } from "./server-env";
import {
  decodeAwarenessUpdate,
  encodeAwarenessEntries,
  normalizeCloseCode,
  RoomCore,
  ROOM_COMPACT_UPDATE_COUNT,
  sanitizeAwarenessState,
  type RoomSocket,
  type RoomSocketAttachment,
  type RoomStorage,
} from "./room-core";
import { createCollabTokenHandler } from "./token-handler";
import { signCollabToken, verifyCollabToken } from "./token";
import { handleCollabWebSocket, readCollabRoomEpoch } from "./worker-route";

const SECRET = "test-only-collab-secret";
const NOW = Date.UTC(2026, 10, 1, 0, 0, 0);

test("토큰: 서명·만료·room key가 모두 맞을 때만 통과한다", async () => {
  const token = await signCollabToken({ key: "note:n1", userId: "u1", mode: "write" }, SECRET, NOW);
  assert.deepEqual(
    { ...(await verifyCollabToken(token, "note:n1", SECRET, NOW + 1000)), exp: 0 },
    { k: "note:n1", u: "u1", m: "write", exp: 0 },
  );
  assert.equal(await verifyCollabToken(token, "note:n2", SECRET, NOW), null, "다른 문서");
  assert.equal(await verifyCollabToken(token, "note:n1", "other-secret", NOW), null, "다른 비밀");
  assert.equal(await verifyCollabToken(token, "note:n1", SECRET, NOW + 61_000), null, "만료");
  const [payload, signature] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ k: "note:n1", u: "u1", m: "write", exp: 9e9 })).toString("base64url");
  assert.equal(await verifyCollabToken(`${forgedPayload}.${signature}`, "note:n1", SECRET, NOW), null, "내용 바꿈");
  assert.equal(await verifyCollabToken(`${payload}.`, "note:n1", SECRET, NOW), null, "서명 없음");
  assert.equal(await verifyCollabToken("garbage", "note:n1", SECRET, NOW), null);
});

test("room key: 허용된 형식만 읽는다", () => {
  assert.deepEqual(parseCollabDocKey("note:abc-1"), { kind: "note", id: "abc-1" });
  assert.deepEqual(parseCollabDocKey("draft:qna-reply:u1:t1"), { kind: "draft", draftKind: "qna-reply", ownerId: "u1", scope: "t1" });
  for (const bad of ["note:", "note:a:b", "user:x", "draft:post:u1", "draft:evil:u1:s", "note:../x", "note:a b", 3, null]) {
    assert.equal(parseCollabDocKey(bad), null, String(bad));
  }
  assert.throws(() => formatCollabDocKey({ kind: "note", id: "a/b" }));
});

function loaders(overrides: Partial<CollabDocumentLoaders> = {}): CollabDocumentLoaders {
  return {
    findNote: async (id) =>
      ({
        mine: { studentId: "s1", authorId: "s1", deletedAt: null },
        stann: { studentId: "s1", authorId: "admin", deletedAt: null },
        trashed: { studentId: "s1", authorId: "s1", deletedAt: new Date(NOW) },
      })[id] ?? null,
    findPost: async (id) =>
      ({ p1: { authorId: "s1", deletedAt: null }, gone: { authorId: "s1", deletedAt: new Date(NOW) } })[id] ?? null,
    findGuidePage: async (id) => (id === "g1" ? { id } : null),
    findQnaThread: async (id) => (id === "t1" ? { studentId: "s1", deletedAt: null } : null),
    isActiveStudent: async (id) => id === "s1" || id === "s2",
    ...overrides,
  };
}
const student1 = { id: "s1", isAdmin: false };
const student2 = { id: "s2", isAdmin: false };
const admin = { id: "admin", isAdmin: true };

test("권한: 노트는 학생 본인·관리자만, 쓰기는 작성자·관리자만", async () => {
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:mine" }, loaders()), { ok: true, key: "note:mine", mode: "write" });
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:stann" }, loaders()), { ok: true, key: "note:stann", mode: "read" });
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "note:stann" }, loaders()), { ok: true, key: "note:stann", mode: "write" });
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "note:mine" }, loaders()), { ok: true, key: "note:mine", mode: "write" });
  for (const key of ["note:mine", "note:stann"]) {
    assert.equal((await authorizeCollabRequest(student2, { key }, loaders())).ok, false, `다른 학생 ${key}`);
  }
  assert.equal((await authorizeCollabRequest(student1, { key: "note:trashed" }, loaders())).ok, false, "휴지통");
  assert.equal((await authorizeCollabRequest(admin, { key: "note:missing" }, loaders())).ok, false, "없음");
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "bad key" }, loaders()), { ok: false, reason: "BAD_REQUEST" });
});

test("권한: 새 노트는 결정적 생성 id의 room을 그 학생 공간 쓰기 권한자에게만 연다", async () => {
  const operationId = "6f1c2b8a-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
  const expectedId = deriveCreationResourceId(operationId, JSON.stringify(["private-note", "s1", "s1"]));
  assert.deepEqual(
    await authorizeCollabRequest(student1, { createNote: { operationId, studentId: "s1" } }, loaders()),
    { ok: true, key: `note:${expectedId}`, mode: "write" },
  );
  assert.equal((await authorizeCollabRequest(student2, { createNote: { operationId, studentId: "s1" } }, loaders())).ok, false, "다른 학생 공간");
  const adminResult = await authorizeCollabRequest(admin, { createNote: { operationId, studentId: "s1" } }, loaders());
  assert.equal(adminResult.ok && adminResult.mode, "write");
  assert.equal((await authorizeCollabRequest(admin, { createNote: { operationId, studentId: "nobody" } }, loaders())).ok, false, "학생 아님");
  assert.equal((await authorizeCollabRequest(student1, { createNote: { operationId: "x", studentId: "s1" } }, loaders())).ok, false);
  // 이미 만들어진 노트면 일반 노트 규칙: 다른 학생이 같은 id를 노려도 거부된다.
  const existing = loaders({ findNote: async () => ({ studentId: "s1", authorId: "s1", deletedAt: null }) });
  assert.equal((await authorizeCollabRequest(student2, { createNote: { operationId, studentId: "s2" } }, existing)).ok, false);
});

test("권한: 가이드는 관리자만, 게시물은 작성자·관리자, 작성본은 본인만", async () => {
  assert.equal((await authorizeCollabRequest(student1, { key: "guide:g1" }, loaders())).ok, false);
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "guide:g1" }, loaders()), { ok: true, key: "guide:g1", mode: "write" });
  assert.equal((await authorizeCollabRequest(admin, { key: "guide:nope" }, loaders())).ok, false);
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "post:p1" }, loaders()), { ok: true, key: "post:p1", mode: "write" });
  assert.equal((await authorizeCollabRequest(student2, { key: "post:p1" }, loaders())).ok, false);
  assert.equal((await authorizeCollabRequest(admin, { key: "post:p1" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(student1, { key: "post:gone" }, loaders())).ok, false);
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:post:s1:new" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(student2, { key: "draft:post:s1:new" }, loaders())).ok, false, "남의 작성본");
  assert.equal((await authorizeCollabRequest(admin, { key: "draft:post:s1:new" }, loaders())).ok, false, "관리자도 남의 작성본은 거부");
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:qna-reply:s1:t1" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(student2, { key: "draft:qna-reply:s2:t1" }, loaders())).ok, false, "남의 질문 답글");
  assert.equal((await authorizeCollabRequest(admin, { key: "draft:qna-reply:admin:t1" }, loaders())).ok, true);
});

test("토큰 route: 비로그인 401, 권한 없음 403, binding 없으면 혼자 모드", async () => {
  const base = { loaders: loaders(), getSecret: () => SECRET, isCollabAvailable: () => true };
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://portal.test/api/collab/token", { method: "POST", body: JSON.stringify(body), headers });
  const anonymous = createCollabTokenHandler({ ...base, getActor: async () => null });
  assert.equal((await anonymous(request({ key: "note:mine" }))).status, 401);
  const asStudent2 = createCollabTokenHandler({ ...base, getActor: async () => ({ ...student2, displayName: "이학생" }) });
  assert.equal((await asStudent2(request({ key: "note:mine" }))).status, 403);
  const asStudent1 = createCollabTokenHandler({ ...base, getActor: async () => ({ ...student1, displayName: "김학생" }) });
  assert.equal((await asStudent1(request({ key: "note:mine" }, { Origin: "https://evil.test" }))).status, 403, "다른 origin");
  const ok = (await (await asStudent1(request({ key: "note:mine" }))).json()) as { collab: boolean; token: string; path: string; mode: string };
  assert.equal(ok.collab, true);
  assert.equal(ok.mode, "write");
  assert.equal(ok.path, "/api/collab/ws/note%3Amine");
  assert.ok(await verifyCollabToken(ok.token, "note:mine", SECRET));
  const solo = createCollabTokenHandler({ ...base, isCollabAvailable: () => false, getActor: async () => ({ ...student1, displayName: "김학생" }) });
  const soloBody = (await (await solo(request({ key: "note:mine" }))).json()) as Record<string, unknown>;
  assert.equal(soloBody.collab, false);
  assert.equal("token" in soloBody, false);
});

type FakeStub = { requests: Request[]; fetch(input: string | Request): Promise<Response> };
function fakeNamespace() {
  const stub: FakeStub = {
    requests: [],
    async fetch(input) {
      stub.requests.push(input as Request);
      return new Response("upgraded", { status: 200 });
    },
  };
  return { stub, namespace: { idFromName: (name: string) => name, get: () => stub } };
}

test("worker 경로: 토큰을 확인하고 검증된 claims만 room에 넘긴다", async () => {
  const { stub, namespace } = fakeNamespace();
  const env = { DOC_ROOMS: namespace, AUTH_SECRET: SECRET };
  const token = await signCollabToken({ key: "note:n1", userId: "u1", mode: "read" }, SECRET, NOW);
  const upgrade = (protocol: string | null, extra: Record<string, string> = {}, path = "/api/collab/ws/note%3An1") =>
    new Request(`https://portal.test${path}`, {
      headers: {
        Upgrade: "websocket",
        ...(protocol ? { "Sec-WebSocket-Protocol": protocol } : {}),
        ...extra,
      },
    });
  assert.equal((await handleCollabWebSocket(upgrade(null), env, NOW)).status, 401, "토큰 없음");
  assert.equal((await handleCollabWebSocket(upgrade(`${COLLAB_SUBPROTOCOL}, bad.token`), env, NOW)).status, 401);
  assert.equal((await handleCollabWebSocket(upgrade(`${COLLAB_SUBPROTOCOL}, ${token}`, {}, "/api/collab/ws/note%3Aother"), env, NOW)).status, 401, "다른 문서 토큰");
  assert.equal((await handleCollabWebSocket(upgrade(`${COLLAB_SUBPROTOCOL}, ${token}`, { Origin: "https://evil.test" }), env, NOW)).status, 403);
  assert.equal((await handleCollabWebSocket(upgrade(`${COLLAB_SUBPROTOCOL}, ${token}`), env, NOW + 120_000)).status, 401, "만료");
  assert.equal((await handleCollabWebSocket(new Request("https://portal.test/api/collab/ws/note%3An1"), env, NOW)).status, 426);
  assert.equal(stub.requests.length, 0);
  const forwarded = await handleCollabWebSocket(
    upgrade(`${COLLAB_SUBPROTOCOL}, ${token}`, { [COLLAB_INTERNAL_HEADER_MODE]: "write", [COLLAB_INTERNAL_HEADER_USER]: "admin", Cookie: "secret" }),
    env,
    NOW,
  );
  assert.equal(forwarded.status, 200);
  const sent = stub.requests[0];
  assert.equal(new URL(sent.url).pathname, "/connect");
  assert.equal(sent.headers.get(COLLAB_INTERNAL_HEADER_MODE), "read", "클라이언트가 보낸 mode header는 무시");
  assert.equal(sent.headers.get(COLLAB_INTERNAL_HEADER_USER), "u1");
  assert.equal(sent.headers.get(COLLAB_INTERNAL_HEADER_KEY), "note:n1");
  assert.equal(sent.headers.get("Cookie"), null);
  assert.equal(sent.headers.get("Sec-WebSocket-Protocol"), null, "토큰을 room에 넘기지 않음");
  assert.equal((await handleCollabWebSocket(upgrade(`${COLLAB_SUBPROTOCOL}, ${token}`), { AUTH_SECRET: SECRET }, NOW)).status, 503);
});

class MemoryStorage implements RoomStorage {
  epoch = 0;
  snapshot: Uint8Array | null = null;
  updates: Uint8Array[] = [];
  load() {
    return { epoch: this.epoch, snapshot: this.snapshot, updates: [...this.updates] };
  }
  appendUpdate(update: Uint8Array) {
    this.updates.push(update);
  }
  replaceWithSnapshot(snapshot: Uint8Array) {
    this.snapshot = snapshot;
    this.updates = [];
  }
  reset(nextEpoch: number) {
    this.epoch = nextEpoch;
    this.snapshot = null;
    this.updates = [];
  }
}

class MemorySocket implements RoomSocket {
  sent: Uint8Array[] = [];
  closed: number | null = null;
  attachment: RoomSocketAttachment | null = null;
  send(data: Uint8Array | string) {
    this.sent.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
  }
  close(code: number) {
    this.closed = code;
  }
  getAttachment() {
    return this.attachment;
  }
  setAttachment(value: RoomSocketAttachment) {
    this.attachment = value;
  }
  controls() {
    return this.sent
      .map((bytes) => decoding.createDecoder(bytes))
      .filter((decoder) => decoding.readVarUint(decoder) === COLLAB_MESSAGE_CONTROL)
      .map((decoder) => JSON.parse(decoding.readVarString(decoder)) as { t: string; code?: string; epoch?: number });
  }
}

function updateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function textUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

function roomText(storage: MemoryStorage): string {
  const doc = new Y.Doc();
  const state = storage.load();
  if (state.snapshot) Y.applyUpdate(doc, state.snapshot);
  for (const update of state.updates) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
}

const rooms: RoomCore[] = [];
after(() => {
  for (const room of rooms) room.destroy();
});

function createRoom(now = () => NOW) {
  const storage = new MemoryStorage();
  const sockets: MemorySocket[] = [];
  const room = new RoomCore(storage, () => sockets, now);
  rooms.push(room);
  const join = (mode: "read" | "write", userId = "u") => {
    const socket = new MemorySocket();
    sockets.push(socket);
    room.connect(socket, { userId, mode });
    return socket;
  };
  return { storage, sockets, room, join };
}

test("room: 쓰기 소켓의 update만 저장·전달하고 읽기 소켓의 쓰기는 거부한다", () => {
  const { storage, room, join } = createRoom();
  const writer = join("write", "w");
  const reader = join("read", "r");
  const other = join("write", "w2");
  assert.deepEqual(writer.controls()[0], { t: "hello", epoch: 0, mode: "write" });
  const before = other.sent.length;
  room.message(writer, updateMessage(textUpdate("hello")));
  assert.equal(roomText(storage), "hello");
  assert.equal(other.sent.length, before + 1, "다른 소켓에 전달");
  room.message(reader, updateMessage(textUpdate("EVIL")));
  assert.equal(roomText(storage), "hello", "읽기 소켓 쓰기 반영 안 됨");
  assert.equal(reader.controls().at(-1)?.code, "read-only");
  // 읽기 소켓도 상태 요청(step1)에는 답을 받는다.
  const step1 = encoding.createEncoder();
  encoding.writeVarUint(step1, COLLAB_MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(step1, new Y.Doc());
  const sentBefore = reader.sent.length;
  room.message(reader, encoding.toUint8Array(step1));
  assert.equal(reader.sent.length, sentBefore + 1);
});

test("room: 저장 상태는 새 room 인스턴스(휴면 복귀)에서도 이어지고 update가 쌓이면 압축된다", () => {
  const { storage, room, join } = createRoom();
  const writer = join("write");
  for (let index = 0; index < ROOM_COMPACT_UPDATE_COUNT + 5; index += 1) {
    const doc = new Y.Doc();
    doc.clientID = 1000 + index;
    doc.getText("t").insert(0, "a");
    room.message(writer, updateMessage(Y.encodeStateAsUpdate(doc)));
  }
  assert.ok(storage.snapshot, "snapshot 생성");
  assert.ok(storage.updates.length < ROOM_COMPACT_UPDATE_COUNT);
  const revived = new RoomCore(storage, () => []);
  rooms.push(revived);
  const fresh = new MemorySocket();
  revived.connect(fresh, { userId: "x", mode: "read" });
  assert.equal(roomText(storage).length, ROOM_COMPACT_UPDATE_COUNT + 5);
});

test("room: reset은 저장 상태를 지우고 epoch를 올린 뒤 모든 연결을 닫는다", () => {
  const { storage, room, join } = createRoom();
  const writer = join("write");
  const reader = join("read");
  room.message(writer, updateMessage(textUpdate("old")));
  assert.equal(room.reset(), 1);
  assert.equal(roomText(storage), "");
  assert.equal(storage.epoch, 1);
  for (const socket of [writer, reader]) {
    assert.equal(socket.closed, COLLAB_CLOSE_RESET);
    assert.deepEqual(socket.controls().at(-1), { t: "reset", epoch: 1 });
  }
});

test("room: 큰 메시지·오래된 연결·깨진 메시지는 닫는다", () => {
  let now = NOW;
  const { room, join } = createRoom(() => now);
  const big = join("write");
  room.message(big, new Uint8Array(COLLAB_MAX_MESSAGE_BYTES + 1));
  assert.equal(big.closed, COLLAB_CLOSE_TOO_LARGE);
  const old = join("write");
  now += COLLAB_SOCKET_MAX_AGE_MS + 1;
  room.message(old, updateMessage(textUpdate("late")));
  assert.equal(old.closed, COLLAB_CLOSE_EXPIRED);
  const broken = join("write");
  room.message(broken, new Uint8Array([COLLAB_MESSAGE_SYNC, 9, 9]));
  assert.equal(broken.closed, 1007);
});

test("room: 연결이 끊긴 사람의 커서는 다른 사람 화면에서 지운다", () => {
  const { room, join } = createRoom();
  const writer = join("write");
  const watcher = join("read");
  const clientDoc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(clientDoc);
  awareness.setLocalState({ user: { name: "Stann" } });
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [clientDoc.clientID]));
  room.message(writer, encoding.toUint8Array(encoder));
  assert.deepEqual(writer.attachment?.awarenessClientIds, [clientDoc.clientID]);
  const before = watcher.sent.length;
  room.disconnect(writer);
  assert.equal(watcher.sent.length, before + 1, "커서 삭제 알림");
  awareness.destroy();
  assert.equal(normalizeCloseCode(1005), 1000);
  assert.equal(normalizeCloseCode(4001), 4001);
});

function awarenessMessage(clientId: number, clock: number, state: Record<string, unknown> | null): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessEntries([{ clientId, clock, state: JSON.stringify(state) }]));
  return encoding.toUint8Array(encoder);
}

function lastAwarenessStates(socket: MemorySocket): Array<{ clientId: number; state: Record<string, unknown> | null }> {
  const out: Array<{ clientId: number; state: Record<string, unknown> | null }> = [];
  for (const bytes of socket.sent) {
    const decoder = decoding.createDecoder(bytes);
    if (decoding.readVarUint(decoder) !== COLLAB_MESSAGE_AWARENESS) continue;
    for (const entry of decodeAwarenessUpdate(decoding.readVarUint8Array(decoder))) {
      out.push({ clientId: entry.clientId, state: JSON.parse(entry.state) as Record<string, unknown> | null });
    }
  }
  return out;
}

test("room: 읽기 소켓은 저장 담당 자격을 알릴 수 없고, 사용자 id는 토큰 기준으로 덮어쓴다", () => {
  const { room, join } = createRoom();
  const writer = join("write", "admin");
  const reader = join("read", "student");
  room.message(reader, awarenessMessage(1, 1, { canSave: true, user: { name: "Stann", userId: "admin" } }));
  const seen = lastAwarenessStates(writer).at(-1);
  assert.equal(seen?.clientId, 1);
  assert.equal(seen?.state?.canSave, false, "읽기 소켓 canSave 제거");
  assert.equal((seen?.state?.user as { userId?: string }).userId, "student", "userId 위조 무시");
  room.message(writer, awarenessMessage(2, 1, { canSave: true, user: { name: "Stann" } }));
  assert.equal(lastAwarenessStates(reader).at(-1)?.state?.canSave, true, "쓰기 소켓은 유지");
});

test("room: 다른 소켓이 쓰는 awareness client id는 바꿀 수 없다", () => {
  const { room, join } = createRoom();
  const owner = join("write", "admin");
  const attacker = join("write", "s1");
  const watcher = join("read", "s2");
  room.message(owner, awarenessMessage(7, 1, { canSave: true }));
  const before = watcher.sent.length;
  room.message(attacker, awarenessMessage(7, 5, null));
  assert.equal(watcher.sent.length, before, "가로채기 무시");
  room.disconnect(owner);
  assert.equal(lastAwarenessStates(watcher).at(-1)?.state, null, "소유 소켓이 닫히면 지움");
  assert.equal(sanitizeAwarenessState("not json", { userId: "u", mode: "write", connectedAt: 0, awarenessClientIds: [] }), "null");
});

test("room: 받기만 하는 소켓도 최대 연결 시간이 지나면 다음 전달 때 닫는다", () => {
  let now = NOW;
  const { room, join } = createRoom(() => now);
  const listener = join("read", "s1");
  now += COLLAB_SOCKET_MAX_AGE_MS + 1;
  const writer = join("write", "admin");
  room.message(writer, updateMessage(textUpdate("x")));
  assert.equal(listener.closed, COLLAB_CLOSE_EXPIRED);
  assert.equal(writer.closed, null);
});

test("저장 epoch 확인: binding 없거나 epoch 칸이 없으면 통과, 형식이 틀리면 거부", async () => {
  const empty = new FormData();
  assert.equal(await isStaleCollabSave(empty, "note:n1"), false);
  const bad = new FormData();
  bad.set(COLLAB_EPOCH_FIELD, "-1");
  assert.equal(await isStaleCollabSave(bad, "note:n1"), true);
  const ok = new FormData();
  ok.set(COLLAB_EPOCH_FIELD, "3");
  assert.equal(await isStaleCollabSave(ok, "note:n1"), false, "binding 없음(next dev·테스트)");
});

test("room epoch 조회: worker env의 room에서 지금 epoch를 읽는다", async () => {
  const stub = { fetch: async () => Response.json({ epoch: 4 }) };
  const env = { DOC_ROOMS: { idFromName: (name: string) => name, get: () => stub } };
  assert.equal(await readCollabRoomEpoch(env, "note:n1"), 4);
  assert.equal(await readCollabRoomEpoch(undefined, "note:n1"), null);
});

test("room: 휴면 복귀 뒤에도 소켓 attachment로 awareness 소유권을 되살린다", () => {
  const storage = new MemoryStorage();
  const sockets: MemorySocket[] = [];
  const first = new RoomCore(storage, () => sockets, () => NOW);
  rooms.push(first);
  const owner = new MemorySocket();
  const reader = new MemorySocket();
  sockets.push(owner, reader);
  first.connect(owner, { userId: "admin", mode: "write" });
  first.connect(reader, { userId: "s1", mode: "read" });
  first.message(owner, awarenessMessage(9, 1, { canSave: true }));
  // DO가 휴면에서 깨어나면 메모리(RoomCore)는 새로 만들어지고 소켓·attachment만 남는다.
  const revived = new RoomCore(storage, () => sockets, () => NOW);
  rooms.push(revived);
  const before = owner.sent.length;
  revived.message(reader, awarenessMessage(9, 50, { canSave: false }));
  assert.equal(owner.sent.length, before, "읽기 소켓이 작성자 client id를 가로채지 못함");
  revived.message(owner, awarenessMessage(9, 2, { canSave: true }));
  assert.equal(lastAwarenessStates(reader).at(-1)?.state?.canSave, true, "주인은 계속 갱신");
});

test("room: 최대 연결 시간이 지난 소켓은 awareness 전달 때도 닫는다", () => {
  let now = NOW;
  const { room, join } = createRoom(() => now);
  const listener = join("read", "s1");
  now += COLLAB_SOCKET_MAX_AGE_MS + 1;
  const writer = join("write", "admin");
  room.message(writer, awarenessMessage(3, 1, { canSave: true }));
  assert.equal(listener.closed, COLLAB_CLOSE_EXPIRED);
});
