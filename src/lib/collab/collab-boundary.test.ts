import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
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
  COLLAB_LEASE_SECONDS,
  COLLAB_CLOSE_GONE,
  COLLAB_CLOSE_STALE,
  COLLAB_EPOCH_FIELD,
  COLLAB_SUBPROTOCOL,
} from "./protocol";
import { isStaleCollabSave } from "./server-env";
import {
  decodeAwarenessUpdate,
  encodeAwarenessEntries,
  normalizeCloseCode,
  parseStoredContributors,
  parseStoredDowngradedAt,
  RoomCore,
  ROOM_COMPACT_MAX_UPDATE_COUNT,
  ROOM_COMPACT_MIN_BYTES,
  ROOM_COMPACT_UPDATE_COUNT,
  ROOM_RESTORE_HOLD_MS,
  ROOM_RESTORE_INTENT_MS,
  type RestoreIntent,
  sanitizeAwarenessState,
  type RoomSocket,
  type RoomSocketAttachment,
  type RoomStorage,
} from "./room-core";
import { createCollabTokenHandler } from "./token-handler";
import { collabSavedMarker } from "./saved-marker";
import { signCollabToken, verifyCollabToken } from "./token";
import { handleCollabWebSocket, readCollabRoomEpoch } from "./worker-route";

const SECRET = "test-only-collab-secret";
const LEASE_MS = COLLAB_LEASE_SECONDS * 1000;
const NOW = Date.UTC(2026, 10, 1, 0, 0, 0);

test("토큰: 서명·만료·room key가 모두 맞을 때만 통과한다", async () => {
  const token = await signCollabToken({ key: "note:n1", userId: "u1", mode: "write" }, SECRET, NOW);
  assert.deepEqual(
    { ...(await verifyCollabToken(token, "note:n1", SECRET, NOW + 1000)), exp: 0 },
    { k: "note:n1", u: "u1", m: "write", exp: 0, i: NOW, l: Math.floor(NOW / 1000) + COLLAB_LEASE_SECONDS },
  );
  const withLifecycle = await signCollabToken({ key: "note:n1", userId: "u1", mode: "write", lifecycle: 4 }, SECRET, NOW);
  assert.equal((await verifyCollabToken(withLifecycle, "note:n1", SECRET, NOW))?.e, 4, "노트 세대를 싣는다");
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
        mine: { studentId: "s1", authorId: "s1", groupId: null, studentReadOnly: false, deletedAt: null, lifecycle: 0 },
        stann: { studentId: "s1", authorId: "admin", groupId: null, studentReadOnly: false, deletedAt: null, lifecycle: 7 },
        trashed: { studentId: "s1", authorId: "s1", groupId: null, studentReadOnly: false, deletedAt: new Date(NOW), lifecycle: 0 },
        // 그룹 g1(멤버 s1·s3)의 그룹 노트. 만든 사람은 s1, 관리자가 만든 것은 student_id가 관리자다.
        group: { studentId: "s1", authorId: "s1", groupId: "g1", studentReadOnly: false, deletedAt: null, lifecycle: 3 },
        groupByAdmin: { studentId: "admin", authorId: "admin", groupId: "g1", studentReadOnly: false, deletedAt: null, lifecycle: 0 },
        // 관리자가 학생 편집을 막은 노트(개인·그룹).
        stannLocked: { studentId: "s1", authorId: "admin", groupId: null, studentReadOnly: true, deletedAt: null, lifecycle: 0 },
        groupLocked: { studentId: "admin", authorId: "admin", groupId: "g1", studentReadOnly: true, deletedAt: null, lifecycle: 0 },
        groupTrashed: { studentId: "s1", authorId: "s1", groupId: "g1", studentReadOnly: false, deletedAt: new Date(NOW), lifecycle: 0 },
      })[id] ?? null,
    findPost: async (id) =>
      ({ p1: { authorId: "s1", deletedAt: null, lifecycle: 2 }, gone: { authorId: "s1", deletedAt: new Date(NOW), lifecycle: 0 } })[id] ?? null,
    findGuidePage: async (id) =>
      ({ g1: { id: "g1", deletedAt: null, lifecycle: 3 }, gTrash: { id: "gTrash", deletedAt: new Date(NOW), lifecycle: 0 } })[id] ?? null,
    findQnaThread: async (id) => (id === "t1" ? { studentId: "s1", deletedAt: null } : null),
    findQnaReply: async (id) =>
      ({ r1: { authorId: "s1", threadDeletedAt: null }, rAdmin: { authorId: "admin", threadDeletedAt: null }, rTrash: { authorId: "s1", threadDeletedAt: new Date(NOW) } })[id] ?? null,
    isActiveStudent: async (id) => id === "s1" || id === "s2" || id === "s3",
    isGroupMember: async (studentId, groupId) => groupId === "g1" && (studentId === "s1" || studentId === "s3"),
    ...overrides,
  };
}
const student1 = { id: "s1", isAdmin: false };
const student2 = { id: "s2", isAdmin: false };
const admin = { id: "admin", isAdmin: true };

test("권한: 노트는 학생 본인·관리자만 읽고 쓴다(Stann이 만든 노트도 학생이 쓴다)", async () => {
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:mine" }, loaders()), { ok: true, key: "note:mine", mode: "write", lifecycle: 0 });
  // 2026-11-23 사용자 결정: Stann이 만든 그 학생의 개인 노트도 학생이 함께 쓴다(이전에는 "read").
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:stann" }, loaders()), { ok: true, key: "note:stann", mode: "write", lifecycle: 7 });
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "note:stann" }, loaders()), { ok: true, key: "note:stann", mode: "write", lifecycle: 7 });
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "note:mine" }, loaders()), { ok: true, key: "note:mine", mode: "write", lifecycle: 0 });
  for (const key of ["note:mine", "note:stann"]) {
    assert.equal((await authorizeCollabRequest(student2, { key }, loaders())).ok, false, `다른 학생 ${key}`);
  }
  // 휴지통은 볼 권한이 있는 사람에게만 TRASHED로 구분한다(열린 편집기가 되살림을 기다린다). 남에게는 없음과 같다.
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:trashed" }, loaders()), { ok: false, reason: "TRASHED" });
  assert.deepEqual(await authorizeCollabRequest(student2, { key: "note:trashed" }, loaders()), { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" });
  assert.equal((await authorizeCollabRequest(admin, { key: "note:missing" }, loaders())).ok, false, "없음");
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "bad key" }, loaders()), { ok: false, reason: "BAD_REQUEST" });
});

test("권한: 관리자가 학생 편집을 막은 노트는 학생·멤버에게 읽기 전용 연결이고 관리자는 그대로 쓴다", async () => {
  const student3 = { id: "s3", isAdmin: false };
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:stannLocked" }, loaders()), { ok: true, key: "note:stannLocked", mode: "read", lifecycle: 0 });
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "note:stannLocked" }, loaders()), { ok: true, key: "note:stannLocked", mode: "write", lifecycle: 0 });
  assert.equal((await authorizeCollabRequest(student2, { key: "note:stannLocked" }, loaders())).ok, false, "다른 학생은 여전히 거부");
  for (const actor of [student1, student3]) {
    assert.deepEqual(await authorizeCollabRequest(actor, { key: "note:groupLocked" }, loaders()), { ok: true, key: "note:groupLocked", mode: "read", lifecycle: 0 });
  }
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "note:groupLocked" }, loaders()), { ok: true, key: "note:groupLocked", mode: "write", lifecycle: 0 });
  assert.equal((await authorizeCollabRequest(student2, { key: "note:groupLocked" }, loaders())).ok, false, "멤버가 아니면 거부");
});

test("권한: 그룹 노트는 관리자·지금 그 그룹 멤버가 읽고 함께 고치고, 그 밖은 거부한다", async () => {
  const student3 = { id: "s3", isAdmin: false };
  for (const key of ["note:group", "note:groupByAdmin"]) {
    const lifecycle = key === "note:group" ? 3 : 0;
    assert.deepEqual(await authorizeCollabRequest(student1, { key }, loaders()), { ok: true, key, mode: "write", lifecycle }, `만든 멤버 ${key}`);
    assert.deepEqual(await authorizeCollabRequest(student3, { key }, loaders()), { ok: true, key, mode: "write", lifecycle }, `다른 멤버 ${key}`);
    assert.deepEqual(await authorizeCollabRequest(admin, { key }, loaders()), { ok: true, key, mode: "write", lifecycle }, `관리자 ${key}`);
    assert.deepEqual(await authorizeCollabRequest(student2, { key }, loaders()), { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" }, `멤버 아님 ${key}`);
  }
  // 그룹을 떠나면(만든 사람이어도) 접근을 잃는다: student_id·author_id로 정하지 않는다.
  const left = loaders({ isGroupMember: async (studentId) => studentId === "s3" });
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "note:group" }, left), { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" });
  assert.equal((await authorizeCollabRequest(student3, { key: "note:group" }, left)).ok, true);
  // 휴지통의 그룹 노트는 멤버에게 TRASHED, 남에게는 없음과 같다.
  assert.deepEqual(await authorizeCollabRequest(student3, { key: "note:groupTrashed" }, loaders()), { ok: false, reason: "TRASHED" });
  assert.deepEqual(await authorizeCollabRequest(student2, { key: "note:groupTrashed" }, loaders()), { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" });
  // 관리자는 멤버십을 묻지 않는다.
  let asked = 0;
  const counting = loaders({ isGroupMember: async () => { asked += 1; return false; } });
  assert.equal((await authorizeCollabRequest(admin, { key: "note:group" }, counting)).ok, true);
  assert.equal(asked, 0);
  // 이미 만든 그룹 노트의 생성 room 요청도 그룹 규칙을 따른다.
  const operationId = "6f1c2b8a-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
  const created = loaders({ findNote: async () => ({ studentId: "s1", authorId: "s1", groupId: "g1", studentReadOnly: false, deletedAt: null, lifecycle: 0 }) });
  assert.equal((await authorizeCollabRequest(student2, { createNote: { operationId, studentId: "s2" } }, created)).ok, false, "멤버 아님");
  assert.equal((await authorizeCollabRequest(student3, { createNote: { operationId, studentId: "s3" } }, created)).ok, true, "멤버");
});

test("권한: 새 노트는 결정적 생성 id의 room을 그 학생 공간 쓰기 권한자에게만 연다", async () => {
  const operationId = "6f1c2b8a-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
  const expectedId = deriveCreationResourceId(operationId, JSON.stringify(["private-note", "s1", "s1"]));
  assert.deepEqual(
    await authorizeCollabRequest(student1, { createNote: { operationId, studentId: "s1" } }, loaders()),
    { ok: true, key: `note:${expectedId}`, mode: "write", lifecycle: 0 },
  );
  assert.equal((await authorizeCollabRequest(student2, { createNote: { operationId, studentId: "s1" } }, loaders())).ok, false, "다른 학생 공간");
  const adminResult = await authorizeCollabRequest(admin, { createNote: { operationId, studentId: "s1" } }, loaders());
  assert.equal(adminResult.ok && adminResult.mode, "write");
  assert.equal((await authorizeCollabRequest(admin, { createNote: { operationId, studentId: "nobody" } }, loaders())).ok, false, "학생 아님");
  assert.equal((await authorizeCollabRequest(student1, { createNote: { operationId: "x", studentId: "s1" } }, loaders())).ok, false);
  // 이미 만들어진 노트면 일반 노트 규칙: 다른 학생이 같은 id를 노려도 거부된다.
  const existing = loaders({ findNote: async () => ({ studentId: "s1", authorId: "s1", groupId: null, studentReadOnly: false, deletedAt: null, lifecycle: 0 }) });
  assert.equal((await authorizeCollabRequest(student2, { createNote: { operationId, studentId: "s2" } }, existing)).ok, false);
});

test("권한: 가이드는 관리자만, 게시물은 작성자·관리자, 작성본은 본인만", async () => {
  assert.equal((await authorizeCollabRequest(student1, { key: "guide:g1" }, loaders())).ok, false);
  // 가이드 room도 D1 lifecycle 표지(마지막으로 되돌린 판, 0040)를 세대로 받는다.
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "guide:g1" }, loaders()), { ok: true, key: "guide:g1", mode: "write", lifecycle: 3 });
  assert.equal((await authorizeCollabRequest(admin, { key: "guide:nope" }, loaders())).ok, false);
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "post:p1" }, loaders()), { ok: true, key: "post:p1", mode: "write", lifecycle: 2 });
  assert.equal((await authorizeCollabRequest(student2, { key: "post:p1" }, loaders())).ok, false);
  assert.equal((await authorizeCollabRequest(admin, { key: "post:p1" }, loaders())).ok, true);
  assert.deepEqual(await authorizeCollabRequest(student1, { key: "post:gone" }, loaders()), { ok: false, reason: "TRASHED" });
  assert.deepEqual(await authorizeCollabRequest(student2, { key: "post:gone" }, loaders()), { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" });
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:post:s1:new" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(student2, { key: "draft:post:s1:new" }, loaders())).ok, false, "남의 작성본");
  assert.equal((await authorizeCollabRequest(admin, { key: "draft:post:s1:new" }, loaders())).ok, false, "관리자도 남의 작성본은 거부");
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:qna-reply:s1:t1" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(student2, { key: "draft:qna-reply:s2:t1" }, loaders())).ok, false, "남의 질문 답글");
  assert.equal((await authorizeCollabRequest(admin, { key: "draft:qna-reply:admin:t1" }, loaders())).ok, true);
  // 휴지통 가이드(0039)는 room을 열지 않는다.
  assert.deepEqual(await authorizeCollabRequest(admin, { key: "guide:gTrash" }, loaders()), { ok: false, reason: "TRASHED" });
  assert.equal((await authorizeCollabRequest(student1, { key: "guide:gTrash" }, loaders())).ok, false);
  // 답글 고치기 작성본(감사 보완 #7): 그 답글 작성자 본인만, 휴지통 질문은 거부. 관리자도 학생 답글은 못 고친다.
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:qna-reply-edit:s1:r1" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(admin, { key: "draft:qna-reply-edit:admin:r1" }, loaders())).ok, false, "관리자가 학생 답글");
  assert.equal((await authorizeCollabRequest(student2, { key: "draft:qna-reply-edit:s2:r1" }, loaders())).ok, false, "남의 답글");
  assert.equal((await authorizeCollabRequest(student2, { key: "draft:qna-reply-edit:s1:r1" }, loaders())).ok, false, "남의 작성본");
  assert.equal((await authorizeCollabRequest(admin, { key: "draft:qna-reply-edit:admin:rAdmin" }, loaders())).ok, true);
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:qna-reply-edit:s1:rTrash" }, loaders())).ok, false, "휴지통 질문");
  assert.equal((await authorizeCollabRequest(student1, { key: "draft:qna-reply-edit:s1:none" }, loaders())).ok, false);
});

test("토큰 route: 비로그인 401, 권한 없음 403, 휴지통 410, binding 없으면 혼자 모드", async () => {
  const base = { loaders: loaders(), getSecret: () => SECRET, isCollabAvailable: () => true };
  const request = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://portal.test/api/collab/token", { method: "POST", body: JSON.stringify(body), headers });
  const anonymous = createCollabTokenHandler({ ...base, getActor: async () => null });
  assert.equal((await anonymous(request({ key: "note:mine" }))).status, 401);
  const asStudent2 = createCollabTokenHandler({ ...base, getActor: async () => ({ ...student2, displayName: "이학생" }) });
  assert.equal((await asStudent2(request({ key: "note:mine" }))).status, 403);
  const asStudent1 = createCollabTokenHandler({ ...base, getActor: async () => ({ ...student1, displayName: "김학생" }) });
  assert.equal((await asStudent1(request({ key: "note:mine" }, { Origin: "https://evil.test" }))).status, 403, "다른 origin");
  assert.equal((await asStudent1(request({ key: "note:trashed" }))).status, 410, "휴지통은 410(되살림 대기)");
  assert.equal((await asStudent2(request({ key: "note:trashed" }))).status, 403, "남의 휴지통 노트는 없음과 같다");
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
  seq = 0;
  savedSv: Uint8Array | null = null;
  contributors: string[] = [];
  contributorClocks: Record<string, Record<string, number>> = {};
  downgradedAt: Record<string, number> = {};
  load() {
    return {
      epoch: this.epoch,
      snapshot: this.snapshot,
      updates: [...this.updates],
      seq: this.seq,
      savedSv: this.savedSv,
      restoreIntent: this.restoreIntent,
      contributors: [...this.contributors],
      contributorClocks: { ...this.contributorClocks },
      downgradedAt: { ...this.downgradedAt },
    };
  }
  setContributors(ids: readonly string[], clocks: Record<string, Record<string, number>> = {}) {
    this.contributors = [...ids];
    this.contributorClocks = { ...clocks };
  }
  setDowngradedAt(value: Record<string, number>) {
    this.downgradedAt = { ...value };
  }
  setSeq(seq: number) {
    this.seq = seq;
  }
  setSavedSv(sv: Uint8Array | null) {
    this.savedSv = sv;
  }
  appendUpdate(update: Uint8Array) {
    this.updates.push(update);
  }
  replaceWithSnapshot(snapshot: Uint8Array) {
    this.snapshot = snapshot;
    this.updates = [];
  }
  restoreIntent: RestoreIntent | null = null;
  reset(nextEpoch: number) {
    this.epoch = nextEpoch;
    this.snapshot = null;
    this.updates = [];
    this.savedSv = null;
    this.restoreIntent = null;
    this.contributors = [];
  }
  setEpoch(epoch: number) {
    this.epoch = epoch;
  }
  setRestoreIntent(intent: RestoreIntent | null) {
    this.restoreIntent = intent;
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
      .map((decoder) => JSON.parse(decoding.readVarString(decoder)) as { t: string; code?: string; epoch?: number; n?: number; id?: string; mode?: string; seq?: number; lifecycle?: number; base?: string });
  }
  /** 받은 메시지 종류 순서(control은 t, sync는 "sync"). */
  kinds() {
    return this.sent.map((bytes) => {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === COLLAB_MESSAGE_CONTROL) return (JSON.parse(decoding.readVarString(decoder)) as { t: string }).t;
      return type === COLLAB_MESSAGE_SYNC ? "sync" : "awareness";
    });
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

function createRoom(now = () => NOW, verifier: ConstructorParameters<typeof RoomCore>[3] = null) {
  const storage = new MemoryStorage();
  const sockets: MemorySocket[] = [];
  const room = new RoomCore(storage, () => sockets.filter((socket) => socket.closed === null), now, verifier);
  rooms.push(room);
  const join = (mode: "read" | "write", userId = "u", extra: { lifecycle?: number; leaseIat?: number } = {}) => {
    const socket = new MemorySocket();
    sockets.push(socket);
    room.connect(socket, { userId, mode, key: "note:n1", ...extra });
    return socket;
  };
  return { storage, sockets, room, join };
}

test("room: 쓰기 소켓의 update만 저장·전달하고 읽기 소켓의 쓰기는 거부한다", () => {
  const { storage, room, join } = createRoom();
  const writer = join("write", "w");
  const reader = join("read", "r");
  const other = join("write", "w2");
  assert.deepEqual(writer.controls()[0], { t: "hello", epoch: 0, mode: "write", seq: 0 });
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
  const typeOne = (index: number) => {
    const doc = new Y.Doc();
    doc.clientID = 1000 + index;
    doc.getText("t").insert(0, "a");
    room.message(writer, updateMessage(Y.encodeStateAsUpdate(doc)));
  };
  // 작은 update는 개수만 차서는 접지 않는다(쌓인 바이트가 작으면 전체를 다시 쓰는 비용이 더 크다).
  for (let index = 0; index < ROOM_COMPACT_UPDATE_COUNT + 5; index += 1) typeOne(index);
  assert.equal(storage.snapshot, null, "작은 update 수백 개로는 접지 않는다");
  // 개수가 아주 많아지면(깨울 때 다시 적용할 양) 크기와 관계없이 접는다.
  for (let index = ROOM_COMPACT_UPDATE_COUNT + 5; index < ROOM_COMPACT_MAX_UPDATE_COUNT + 5; index += 1) typeOne(index);
  assert.ok(storage.snapshot, "snapshot 생성");
  assert.ok(storage.updates.length < ROOM_COMPACT_UPDATE_COUNT);
  const revived = new RoomCore(storage, () => []);
  rooms.push(revived);
  const fresh = new MemorySocket();
  revived.connect(fresh, { userId: "x", mode: "read" });
  assert.equal(roomText(storage).length, ROOM_COMPACT_MAX_UPDATE_COUNT + 5);
});

test("room: 개수가 차고 쌓인 바이트가 snapshot의 절반(최소 64 KiB)을 넘으면 접는다", () => {
  const { storage, room, join } = createRoom();
  const writer = join("write");
  const chunk = "x".repeat(Math.ceil(ROOM_COMPACT_MIN_BYTES / ROOM_COMPACT_UPDATE_COUNT) + 16);
  for (let index = 0; index < ROOM_COMPACT_UPDATE_COUNT + 1; index += 1) {
    const doc = new Y.Doc();
    doc.clientID = 5000 + index;
    doc.getText("t").insert(0, chunk);
    room.message(writer, updateMessage(Y.encodeStateAsUpdate(doc)));
  }
  assert.ok(storage.snapshot, "큰 편집이 쌓이면 개수 기준에서 접는다");
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
  now += LEASE_MS + 1;
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
  assert.equal(
    sanitizeAwarenessState("not json", { userId: "u", mode: "write", key: "note:n1", connectedAt: 0, validUntil: 0, leaseIat: 0, applied: 0, awarenessClientIds: [] }),
    "null",
  );
});

test("room: 받기만 하는 소켓도 최대 연결 시간이 지나면 다음 전달 때 닫는다", () => {
  let now = NOW;
  const { room, join } = createRoom(() => now);
  const listener = join("read", "s1");
  now += LEASE_MS + 1;
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
  now += LEASE_MS + 1;
  const writer = join("write", "admin");
  room.message(writer, awarenessMessage(3, 1, { canSave: true }));
  assert.equal(listener.closed, COLLAB_CLOSE_EXPIRED);
});

function controlMessage(message: Record<string, unknown>): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLAB_MESSAGE_CONTROL);
  encoding.writeVarString(encoder, JSON.stringify(message));
  return encoding.toUint8Array(encoder);
}

function storedDoc(storage: MemoryStorage): Y.Doc {
  const doc = new Y.Doc();
  const state = storage.load();
  if (state.snapshot) Y.applyUpdate(doc, state.snapshot);
  for (const update of state.updates) Y.applyUpdate(doc, update);
  return doc;
}

/** 클라이언트가 저장 뒤 보고하는 저장 표지(snapshot, base64). */
function roomStateVector(storage: MemoryStorage): string {
  return Buffer.from(collabSavedMarker(storedDoc(storage))).toString("base64");
}

test("room: 마지막 저장 뒤 내용을 바꾼 사람을 연결 토큰의 사용자로 기록하고, 받아들인 저장에서 비우며 휴면 복귀에도 남긴다", () => {
  const { storage, room, join } = createRoom();
  const admin = join("write", "admin");
  const student = join("write", "s1");
  const reader = join("read", "s2");
  room.message(student, updateMessage(textUpdate("학생")));
  room.message(reader, updateMessage(textUpdate("거부")));
  room.message(admin, updateMessage(textUpdate("관리자")));
  room.message(student, updateMessage(textUpdate("또")));
  assert.deepEqual(room.readContributors(), ["s1", "admin"], "처음 바꾼 순서, 읽기 소켓·중복 제외");
  const revived = new RoomCore(storage, () => []);
  rooms.push(revived);
  assert.deepEqual(revived.readContributors(), ["s1", "admin"], "저장소에서 다시 읽는다");
  // 저장 담당(관리자)이 지금 상태와 다른 표지를 보고하면 받아들이지 않고 편집자도 남긴다.
  room.message(admin, controlMessage({ t: "saved", sv: Buffer.from(collabSavedMarker(new Y.Doc())).toString("base64") }));
  assert.deepEqual(room.readContributors(), ["s1", "admin"]);
  room.message(admin, controlMessage({ t: "saved", sv: roomStateVector(storage) }));
  assert.deepEqual(room.readContributors(), [], "받아들인 저장 뒤 비운다");
  assert.deepEqual(storage.contributors, []);
  room.message(student, updateMessage(textUpdate("다음")));
  assert.deepEqual(room.readContributors(), ["s1"]);
  room.reset();
  assert.deepEqual(room.readContributors(), [], "reset은 기록을 지운다");
});

test("room: 관리자가 편집을 막으면 그 사용자의 쓰기 연결만 읽기로 내리고 그 뒤 쓰기는 거부한다", () => {
  const { storage, room, join } = createRoom();
  const admin = join("write", "admin");
  const student = join("write", "s1");
  const studentTab = join("write", "s1");
  room.message(student, awarenessMessage(7, 1, { canSave: true }));
  assert.equal(room.downgradeUsers(["s1"]), 2);
  for (const socket of [student, studentTab]) {
    assert.equal(socket.attachment?.mode, "read");
    assert.deepEqual(socket.controls().at(-1), { t: "mode", mode: "read" });
  }
  assert.equal(admin.attachment?.mode, "write", "관리자 연결은 그대로");
  room.message(student, updateMessage(textUpdate("막힘")));
  assert.equal(roomText(storage), "", "내린 뒤 쓰기는 반영되지 않는다");
  assert.equal(student.controls().at(-1)?.code, "read-only");
  assert.equal(room.downgradeUsers(["s1"]), 0, "이미 읽기면 다시 내리지 않는다");
});

test("room: 저장한 스냅샷(saved-upto)에 편집이 모두 들어간 사람만 편집자에서 빼고, 저장 표시만 바꾼 update는 편집으로 세지 않는다", () => {
  const { storage, room, join } = createRoom();
  const admin = join("write", "admin");
  const student = join("write", "s1");
  room.message(student, updateMessage(textUpdate("학생")));
  // 저장 담당이 이 시점의 상태로 스냅샷을 만들었다. 그 뒤 관리자가 이어서 쳤다.
  const savedSv = Buffer.from(Y.encodeStateVector(storedDoc(storage))).toString("base64");
  room.message(admin, updateMessage(textUpdate("관리자")));
  assert.deepEqual(room.readContributors(), ["s1", "admin"]);
  room.message(admin, controlMessage({ t: "saved-upto", sv: savedSv }));
  assert.deepEqual(room.readContributors(), ["admin"], "스냅샷 뒤에 친 관리자만 남는다");
  assert.deepEqual(storage.contributors, ["admin"]);
  // 저장 표시(meta)만 바꾼 update는 처음 쓰든 같은 칸을 다시 쓰든 편집자가 아니다.
  const meta = new Y.Doc();
  meta.getMap("meta").set("savedHash", "h1");
  room.message(student, updateMessage(Y.encodeStateAsUpdate(meta)));
  const beforeRepeat = Y.encodeStateVector(meta);
  meta.getMap("meta").set("savedHash", "h2");
  room.message(student, updateMessage(Y.encodeStateAsUpdate(meta, beforeRepeat)));
  assert.deepEqual(room.readContributors(), ["admin"]);
  // 읽기 소켓의 saved-upto는 무시한다.
  const reader = join("read", "r");
  room.message(reader, controlMessage({ t: "saved-upto", sv: Buffer.from(Y.encodeStateVector(storedDoc(storage))).toString("base64") }));
  assert.deepEqual(room.readContributors(), ["admin"]);
  // 어디까지 바꿨는지 모르는 편집자(이전 형식)는 saved-upto로 빼지 않는다.
  storage.contributorClocks = {};
  const revived = new RoomCore(storage, () => [admin]);
  rooms.push(revived);
  revived.message(admin, controlMessage({ t: "saved-upto", sv: Buffer.from(Y.encodeStateVector(storedDoc(storage))).toString("base64") }));
  assert.deepEqual(revived.readContributors(), ["admin"]);
});

test("room: 처음 쓰는 제목 칸과 지우기만 한 update는 편집이고, 지운 사람은 saved-upto로 빼지 않는다", () => {
  const { storage, room, join } = createRoom();
  const admin = join("write", "admin");
  const student = join("write", "s1");
  const shared = new Y.Doc();
  shared.getText("t").insert(0, "abc");
  room.message(admin, updateMessage(Y.encodeStateAsUpdate(shared)));
  room.message(admin, controlMessage({ t: "saved-upto", sv: Buffer.from(Y.encodeStateVector(storedDoc(storage))).toString("base64") }));
  assert.deepEqual(room.readContributors(), []);
  const title = new Y.Doc();
  title.getMap("meta").set("title", "제목");
  room.message(student, updateMessage(Y.encodeStateAsUpdate(title)));
  assert.deepEqual(room.readContributors(), ["s1"], "처음 쓰는 제목도 편집");
  room.message(student, controlMessage({ t: "saved-upto", sv: Buffer.from(Y.encodeStateVector(storedDoc(storage))).toString("base64") }));
  assert.deepEqual(room.readContributors(), []);
  const before = Y.encodeStateVector(shared);
  shared.getText("t").delete(0, 1);
  const deleteOnly = Y.encodeStateAsUpdate(shared, before);
  assert.equal(Y.decodeUpdate(deleteOnly).structs.length, 0, "지우기만 한 update");
  room.message(student, updateMessage(deleteOnly));
  assert.deepEqual(room.readContributors(), ["s1"], "지우기만 해도 편집");
  room.message(admin, controlMessage({ t: "saved-upto", sv: Buffer.from(Y.encodeStateVector(storedDoc(storage))).toString("base64") }));
  assert.deepEqual(room.readContributors(), ["s1"], "지우기는 state vector로 덮였는지 알 수 없어 남긴다");
});

test("room: 편집을 막은 뒤에는 그 전에 발급된 쓰기 토큰도 읽기로 받고, refresh는 그 사용자 연결에만 보낸다", () => {
  let now = NOW;
  const { room, join } = createRoom(() => now);
  const admin = join("write", "admin");
  join("write", "s1");
  now += 1000;
  room.downgradeUsers(["s1"]);
  const late = join("write", "s1", { leaseIat: now - 500 });
  assert.equal(late.attachment?.mode, "read", "막기 전 토큰으로 늦게 붙어도 읽기");
  assert.equal(late.controls()[0].mode, "read");
  const fresh = join("write", "s1", { leaseIat: now + 10 });
  assert.equal(fresh.attachment?.mode, "write", "막은 뒤 다시 연 다음 받은 토큰은 쓰기");
  const adminBefore = admin.controls().length;
  assert.equal(room.refreshUsers(["s1"]), 3);
  assert.deepEqual(fresh.controls().at(-1), { t: "refresh" });
  assert.equal(admin.controls().length, adminBefore, "관리자 연결에는 보내지 않는다");
  // 다시 열면 막은 시각을 지워, 다시 연 뒤 받은 토큰은 시계 차이와 상관없이 쓰기다.
  const afterUnlock = join("write", "s1", { leaseIat: now - 500 });
  assert.equal(afterUnlock.attachment?.mode, "write");
});

test("room: 메모리에서 내려갔다 깨어나도 attachment에 남긴 이름·저장 담당(커서 제외)을 새로 들어온 사람에게 알린다", () => {
  const { storage, sockets, join } = createRoom();
  const writer = join("write", "w");
  const room = rooms.at(-1)!;
  room.message(writer, awarenessMessage(7, 3, { user: { name: "W" }, canSave: true, cursor: { anchor: 1 } }));
  assert.equal(writer.attachment?.presence?.["7"]?.c, 3);
  assert.equal(JSON.parse(writer.attachment?.presence?.["7"]?.s ?? "{}").cursor, undefined, "커서는 남기지 않는다");
  const revived = new RoomCore(storage, () => sockets.filter((socket) => socket.closed === null));
  rooms.push(revived);
  const joiner = new MemorySocket();
  sockets.push(joiner);
  revived.connect(joiner, { userId: "j", mode: "read", key: "note:n1" });
  const seen = lastAwarenessStates(joiner).find((entry) => entry.clientId === 7);
  assert.equal(seen?.state?.canSave, true);
  assert.equal((seen?.state?.user as { name?: string } | undefined)?.name, "W");
});

test("room: 저장한 update 개수를 그 소켓에 ack로 알린다", () => {
  const { room, join } = createRoom();
  const writer = join("write");
  room.message(writer, updateMessage(textUpdate("a")));
  room.message(writer, updateMessage(textUpdate("b")));
  assert.deepEqual(writer.controls().filter((c) => c.t === "ack").map((c) => c.n), [1, 2]);
  const reader = join("read");
  room.message(reader, updateMessage(textUpdate("x")));
  assert.equal(reader.controls().some((c) => c.t === "ack"), false, "읽기 소켓 쓰기는 ack 없음");
});

function seededUpdate(text = ""): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap("meta").set("seeded", true);
    if (text) doc.getText("t").insert(0, text);
  });
  return Y.encodeStateAsUpdate(doc);
}

test("room 세대: 시드 전 room만 토큰 lifecycle을 따르고, 시드된 room은 비우거나 닫지 않으며, 옛 토큰은 stale로 닫는다", () => {
  const empty = createRoom();
  const first = empty.join("write", "u", { lifecycle: 4 });
  assert.equal(empty.storage.epoch, 4, "지울 내용이 없는 room은 D1 세대를 따른다");
  assert.equal(first.controls()[0].epoch, 4);

  const { storage, room, join } = createRoom();
  const writer = join("write", "u", { lifecycle: 0 });
  room.message(writer, updateMessage(seededUpdate("편집 중")));
  const later = join("write", "u", { lifecycle: 3 });
  assert.equal(storage.epoch, 0, "시드된 room은 복원 적용(restore-apply)으로만 세대가 바뀐다");
  assert.equal(writer.closed, null, "열린 편집기를 닫지 않는다");
  assert.equal(roomText(storage), "편집 중", "내용을 비우지 않는다");
  assert.equal(later.closed, null);
  storage.epoch = 5;
  const fresh = createRoom();
  fresh.storage.epoch = 5;
  const late = fresh.join("write", "u", { lifecycle: 2 });
  assert.equal(late.closed, COLLAB_CLOSE_STALE, "room보다 옛 토큰은 거부");
});

test("room 복원: 준비는 기준 상태를 영속화하고 입력·연결을 막지 않으며, 다른 복원은 busy, 삭제만 한 변경도 저장 안 됨으로 본다", () => {
  let now = NOW;
  const { storage, room, join } = createRoom(() => now);
  const writer = join("write");
  room.message(writer, updateMessage(seededUpdate("x")));
  const begun = room.restoreBegin("r1");
  assert.equal(begun.ok, true);
  assert.equal(begun.ok && begun.clean, false, "저장 표시가 없으면 밀린 내용이 있다");
  assert.equal(begun.ok && begun.seeded, true);
  assert.ok(storage.restoreIntent && storage.restoreIntent.id === "r1", "기준 S를 저장소에 남긴다");
  const another = join("write");
  assert.equal(another.closed, null, "준비 중에도 새 편집기가 붙는다");
  room.message(writer, updateMessage(textUpdate("typing")));
  assert.equal(writer.closed, null, "준비 중 입력도 받는다");
  assert.deepEqual(room.restoreBegin("r2"), { ok: false, reason: "busy" }, "진행 중인 다른 복원");
  now = NOW + ROOM_RESTORE_INTENT_MS + 1;
  assert.equal(room.restoreBegin("r2").ok, true, "중단된 복원 기록은 시간이 지나면 바뀐다");
  room.restoreAbort("r2");
  assert.equal(storage.restoreIntent, null);

  // 저장 뒤 삭제만 한 변경은 state vector가 같아도 "저장 안 됨"이다(delete set까지 비교).
  const editor = join("write");
  room.message(editor, controlMessage({ t: "saved", sv: roomStateVector(storage) }));
  const savedBegin = room.restoreBegin("r3");
  assert.equal(savedBegin.ok && savedBegin.clean, true, "마지막 저장과 같다");
  room.restoreAbort("r3");
  const local = storedDoc(storage);
  const before = Y.encodeStateVector(local);
  local.getText("t").delete(0, 1);
  room.message(editor, updateMessage(Y.encodeStateAsUpdate(local, before)));
  const deleted = room.restoreBegin("r4");
  assert.equal(deleted.ok && deleted.clean, false, "미저장 삭제");
  room.restoreAbort("r4");
});

test("room 복원 적용: 보관 중 입력은 큐에 두었다가 복원 뒤 같은 순서로 반영하고, restored 알림이 복원 update보다 먼저 가며, 한 번만 적용된다", () => {
  const { storage, room, join } = createRoom();
  const typist = join("write", "typist");
  const watcher = join("read", "watcher");
  room.message(typist, updateMessage(seededUpdate("base")));
  assert.equal(room.restoreBegin("op").ok, true);
  const held = room.restoreHold("op");
  assert.equal(held.ok, true);
  assert.ok(held.ok && held.base, "준비 때 기준을 돌려준다");
  const acksBefore = typist.controls().filter((c) => c.t === "ack").length;
  // 보관 중 입력: 소켓을 닫지 않고 ack도 미룬다.
  room.message(typist, updateMessage(textUpdate("during hold")));
  assert.equal(typist.closed, null);
  assert.equal(typist.controls().filter((c) => c.t === "ack").length, acksBefore, "적용 전에는 ack하지 않는다");
  assert.equal(room.isHolding, true);

  const restoreDoc = new Y.Doc();
  Y.applyUpdate(restoreDoc, held.ok ? held.state : new Uint8Array());
  const sv = Y.encodeStateVector(restoreDoc);
  restoreDoc.transact(() => restoreDoc.getMap("meta").set("lifecycle", 9));
  const update = Y.encodeStateAsUpdate(restoreDoc, sv);
  const watcherBefore = watcher.kinds().length;
  assert.deepEqual(room.restoreApply("op", 9, update), { ok: true, applied: true, lifecycle: 9 });
  assert.deepEqual(watcher.kinds().slice(watcherBefore, watcherBefore + 2), ["restored", "sync"], "알림 뒤 복원 update");
  assert.equal(watcher.controls().find((c) => c.t === "restored")?.lifecycle, 9);
  assert.equal(storage.epoch, 9, "lifecycle은 서버가 소유한다");
  assert.equal(storage.restoreIntent, null, "기록 삭제");
  assert.equal(room.isHolding, false);
  assert.ok(typist.controls().filter((c) => c.t === "ack").length > acksBefore, "큐 배출 뒤 ack");
  assert.ok(roomText(storage).includes("during hold"), "보관 중 입력이 남는다");
  assert.equal(typist.closed, null, "복원해도 연결을 닫지 않는다(다시 시작 없음)");
  assert.equal(watcher.closed, null);

  // 같은 target 재시도(응답 유실)·작은 target은 적용하지 않는다.
  const kindsAfter = watcher.kinds().length;
  assert.equal(room.restoreHold("op").ok, true);
  assert.deepEqual(room.restoreApply("op", 9, update), { ok: true, applied: false, lifecycle: 9 });
  assert.equal(watcher.kinds().length, kindsAfter, "두 번째 적용은 아무것도 보내지 않는다");
  assert.deepEqual(room.restoreApply("op", 10, update), { ok: false, reason: "expired" }, "hold 없이 적용할 수 없다");
});

test("room 복원 보관: 시간이 지나면 큐를 배출하고 그 적용은 거부되며, 다른 복원의 보관은 busy", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { storage, room, join } = createRoom();
    const typist = join("write");
    room.message(typist, updateMessage(seededUpdate()));
    assert.equal(room.restoreHold("slow").ok, true);
    assert.deepEqual(room.restoreHold("other"), { ok: false, reason: "busy" });
    room.message(typist, updateMessage(textUpdate("queued")));
    mock.timers.tick(ROOM_RESTORE_HOLD_MS + 1);
    assert.equal(room.isHolding, false);
    assert.ok(roomText(storage).includes("queued"), "보관이 끝나면 입력을 반영한다");
    assert.deepEqual(room.restoreApply("slow", 3, new Uint8Array()), { ok: false, reason: "expired" });
    assert.equal(storage.epoch, 0);
  } finally {
    mock.timers.reset();
  }
});

test("room lease: 더 새 토큰의 renew만 lease를 늘리고, 읽기 토큰이면 강등하며, 지나면 닫는다", async () => {
  let now = NOW;
  const claims = new Map<string, Awaited<ReturnType<typeof verifyCollabToken>>>();
  const { room, join } = createRoom(() => now, async (token) => claims.get(token) ?? null);
  const writer = join("write", "u", { leaseIat: NOW });
  const watcher = join("read", "w");
  room.message(writer, awarenessMessage(4, 1, { canSave: true }));
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  claims.set("t1", { k: "note:n1", u: "u", m: "write", exp: 0, i: NOW + 60_000, l: Math.floor((NOW + 210_000) / 1000) });
  now = NOW + 60_000;
  room.message(writer, controlMessage({ t: "renew", token: "t1" }));
  await flush();
  assert.equal(writer.attachment?.validUntil, Math.floor((NOW + 210_000) / 1000) * 1000);
  claims.set("t-other", { k: "note:n1", u: "someone", m: "write", exp: 0, i: NOW + 70_000, l: Math.floor((NOW + 999_000) / 1000) });
  room.message(writer, controlMessage({ t: "renew", token: "t-other" }));
  room.message(writer, controlMessage({ t: "renew", token: "t1" }));
  await flush();
  assert.equal(writer.attachment?.validUntil, Math.floor((NOW + 210_000) / 1000) * 1000, "재사용·다른 사용자 토큰은 무시");
  claims.set("t2", { k: "note:n1", u: "u", m: "read", exp: 0, i: NOW + 120_000, l: Math.floor((NOW + 270_000) / 1000) });
  room.message(writer, controlMessage({ t: "renew", token: "t2" }));
  await flush();
  assert.equal(writer.attachment?.mode, "read");
  assert.deepEqual(writer.controls().at(-1), { t: "mode", mode: "read" });
  assert.equal(lastAwarenessStates(watcher).at(-1)?.state?.canSave, false, "저장 담당 자격 회수");
  room.message(writer, updateMessage(textUpdate("x")));
  assert.equal(writer.controls().at(-1)?.code, "read-only");
  claims.set("t3", { k: "note:n1", u: "u", m: "write", exp: 0, i: NOW + 180_000, l: Math.floor((NOW + 330_000) / 1000) });
  room.message(writer, controlMessage({ t: "renew", token: "t3" }));
  await flush();
  assert.equal(writer.attachment?.mode, "read", "같은 연결은 다시 쓰기로 올리지 않음");
  assert.equal(room.nextDeadline(), NOW + LEASE_MS, "읽기 소켓의 lease가 가장 이르다");
  now = NOW + LEASE_MS + 1;
  room.sweepExpired();
  assert.equal(watcher.closed, COLLAB_CLOSE_EXPIRED, "조용한 소켓도 alarm에서 닫는다");
  assert.equal(writer.closed, null);
});

test("room 알림·칸·닫기: notify 순번, 시드된 room만 칸 반영, 휴지통은 상태 보존", () => {
  const { storage, room, join } = createRoom();
  const listener = join("read");
  assert.equal(room.notify(), 1);
  assert.deepEqual(listener.controls().at(-1), { t: "changed", seq: 1 });
  const again = join("read");
  assert.equal(again.controls()[0].seq, 1, "hello에 순번");
  assert.equal(room.setMeta("noteDate", "2026-11-02"), false, "시드 전에는 건드리지 않음");
  const writer = join("write");
  const seedDoc = new Y.Doc();
  seedDoc.getMap("meta").set("seeded", true);
  seedDoc.getMap("meta").set("noteDate", "2026-11-01");
  room.message(writer, updateMessage(Y.encodeStateAsUpdate(seedDoc)));
  const before = writer.sent.length;
  assert.equal(room.setMeta("noteDate", "2026-11-02"), true);
  assert.equal(writer.sent.length, before + 1, "작성자에게도 전달");
  room.closeAll(true);
  assert.equal(writer.closed, COLLAB_CLOSE_GONE);
  assert.ok(storage.updates.length > 0, "휴지통은 상태 보존");
});

test("proxy: 공동 편집 토큰 route는 로그인 redirect 대상이 아니다(route가 401/403을 직접 돌려준다)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../proxy.ts", import.meta.url), "utf8");
  const pattern = /matcher:\s*\[\s*"([^"]+)"/u.exec(source)?.[1];
  assert.ok(pattern, "matcher 패턴");
  const matcher = new RegExp(`^${pattern.replace(/\\\\/gu, "\\")}$`, "u");
  assert.equal(matcher.test("/api/collab/token"), false, "토큰 route는 proxy 밖");
  assert.equal(matcher.test("/dashboard/notes/n1"), true, "보호 화면은 proxy 안");
  assert.equal(matcher.test("/api/collab/tokenx"), true, "비슷한 다른 경로는 계속 보호");
});

test("room: 같은 세대의 늦은 칸 변경은 version 순서로만, 다른 세대의 칸 변경은 반영하지 않는다", () => {
  const { room, join } = createRoom();
  const writer = join("write");
  room.message(writer, updateMessage(seededUpdate()));
  assert.equal(room.setMeta("noteDate", "2026-11-03", 7), false, "다른 세대의 늦은 칸 변경은 무시");
  assert.equal(room.setMeta("noteDate", "2026-11-03", 0, 3), true, "B의 이동(v3)");
  assert.equal(room.setMeta("noteDate", "2026-11-02", 0, 2), false, "늦게 온 A의 이동(v2)은 무시");
  assert.equal(room.setMeta("noteDate", "2026-11-04", 0, 4), true);
});

test("room 복원 기록: 같은 작업의 재시도는 처음 기준을 지키고, repair는 남은 기록을 이어받으며, 만료된 보관의 update는 새 보관에 적용되지 않는다", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { storage, room, join } = createRoom();
    const writer = join("write");
    room.message(writer, updateMessage(seededUpdate("S")));
    const first = room.restoreBegin("op");
    room.message(writer, updateMessage(textUpdate("E")));
    const retry = room.restoreBegin("op");
    assert.ok(first.ok && retry.ok);
    assert.deepEqual(retry.ok && retry.state, first.ok && first.state, "재시도는 처음 기준 S를 돌려준다");
    const repaired = room.restoreHold("repair:5");
    assert.ok(repaired.ok);
    assert.deepEqual(repaired.ok && repaired.base, first.ok && first.state, "repair는 중단된 작업의 기준을 이어받는다");
    room.restoreAbort("repair:5");
    const stale = room.restoreHold("op");
    assert.ok(stale.ok);
    mock.timers.tick(ROOM_RESTORE_HOLD_MS + 1);
    const fresh = room.restoreHold("op");
    assert.ok(fresh.ok && stale.ok && fresh.token !== stale.token);
    assert.deepEqual(room.restoreApply("op", 4, new Uint8Array(), stale.ok ? stale.token : ""), { ok: false, reason: "expired" }, "만료된 보관의 update");
    assert.equal(storage.epoch, 0);
    assert.equal(room.restoreApply("op", 4, new Uint8Array(), fresh.ok ? fresh.token : "").ok, true);
    assert.equal(storage.epoch, 4);
  } finally {
    mock.timers.reset();
  }
});

test("room 복원 적용: 저장 transaction이 실패하면 메모리 doc·세대·알림이 바뀌지 않아 재시도가 같은 조건으로 적용한다", () => {
  const storage = new MemoryStorage();
  let failNext = true;
  const transactional = Object.assign(storage, {
    transact<T>(task: () => T): T {
      const snapshot = { epoch: storage.epoch, updates: [...storage.updates], intent: storage.restoreIntent };
      try {
        const result = task();
        if (failNext) {
          failNext = false;
          throw new Error("storage failed");
        }
        return result;
      } catch (error) {
        storage.epoch = snapshot.epoch;
        storage.updates = snapshot.updates;
        storage.restoreIntent = snapshot.intent;
        throw error;
      }
    },
  });
  const sockets: MemorySocket[] = [];
  const room = new RoomCore(transactional, () => sockets);
  const writer = new MemorySocket();
  sockets.push(writer);
  room.connect(writer, { userId: "u", mode: "write", key: "note:n1" });
  room.message(writer, updateMessage(seededUpdate()));
  const held = room.restoreHold("op");
  assert.ok(held.ok);
  const before = writer.kinds().length;
  assert.throws(() => room.restoreApply("op", 2, textUpdate("restored"), held.token));
  assert.equal(room.currentEpoch, 0, "메모리 세대는 그대로");
  assert.equal(writer.kinds().slice(before).includes("restored"), false, "실패하면 알리지 않는다");
  assert.equal(room.restoreApply("op", 2, textUpdate("restored"), held.token).ok, true, "재시도는 적용된다");
  assert.equal(room.currentEpoch, 2);
  assert.ok(writer.kinds().slice(before).includes("restored"));
  room.destroy();
});

test("room 저장값: 이전 형식(id 배열) 편집자 기록과 지금 형식·깨진 값을 모두 읽고, 막은 시각은 숫자만 받는다", () => {
  assert.deepEqual(parseStoredContributors('["a","b",3]'), { ids: ["a", "b"], clocks: {} });
  assert.deepEqual(parseStoredContributors('{"ids":["a"],"clocks":{"a":{"12":4,"x":1,"7":-1},"z":{"1":1}}}'), { ids: ["a"], clocks: { a: { "12": 4 } } });
  assert.deepEqual(parseStoredContributors("{broken"), { ids: [], clocks: {} });
  assert.deepEqual(parseStoredContributors(null), { ids: [], clocks: {} });
  assert.deepEqual(parseStoredDowngradedAt('{"s1":5,"s2":"x"}'), { s1: 5 });
  assert.deepEqual(parseStoredDowngradedAt("[1]"), {});
  assert.deepEqual(parseStoredDowngradedAt(null), {});
});
