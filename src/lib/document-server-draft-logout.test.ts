import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiscardDocumentServerDraftInput,
  DocumentServerDraftMutationResult,
  DocumentServerDraftSnapshot,
} from "./document-server-draft-contract";
import { flushQueuedDocumentServerDraftDiscards } from "./document-server-draft-logout";
import {
  enqueueDocumentServerDraftDiscard,
  enqueueDocumentServerDraftUpsert,
  listQueuedDocumentServerDraftDiscardsForOwner,
} from "./document-server-draft-queue";
import { createDocumentDraftKey, createDocumentServerDraftQueueKey } from "./form-draft";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const DEVICE_ID = "1f08d7f0-2468-4a3c-99f0-4e9b84899f0a";
const SUBMITTED_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const REBASE_OPERATION_ID = "0c3f1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function snapshot(sourceKey: string, payloadHash: string, draftVersion: number): DocumentServerDraftSnapshot {
  return {
    sourceKey,
    kind: "qna-thread",
    contextId: "new",
    payloadJson: "{}",
    payloadHash,
    draftVersion,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
    updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function seedSubmittedDiscard(storage: MemoryStorage, ownerId = "student-1") {
  const sourceKey = createDocumentDraftKey("qna-thread", ownerId, "new");
  enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 2,
    targetPayloadHashes: [SUBMITTED_HASH],
  });
  return sourceKey;
}

test("로그아웃 전 전송 대상은 이 계정의 폐기 요청뿐이다", () => {
  const storage = new MemoryStorage();
  const ownerDiscard = seedSubmittedDiscard(storage);
  seedSubmittedDiscard(storage, "student-2");
  enqueueDocumentServerDraftUpsert(storage, {
    sourceKey: createDocumentDraftKey("note", "student-1", "note-1"),
    data: { title: "아직 저장 중", contentHtml: "<p>본문</p>" },
    expectedDraftVersion: 0,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
  });

  const discards = listQueuedDocumentServerDraftDiscardsForOwner(storage, "student-1");

  assert.deepEqual(discards.map((queued) => queued.entry.sourceKey), [ownerDiscard]);
});

test("폐기 요청이 성공하면 대기열을 비우고 같은 operation ID로 보낸다", async () => {
  const storage = new MemoryStorage();
  const sourceKey = seedSubmittedDiscard(storage);
  const queuedRaw = storage.getItem(createDocumentServerDraftQueueKey(sourceKey));
  const calls: DiscardDocumentServerDraftInput[] = [];

  const result = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    discard: async (input) => {
      calls.push(input);
      return { ok: true, replayed: false, operationResultVersion: 2, current: null };
    },
  });

  assert.deepEqual(result, { attempted: 1, discarded: 1, timedOut: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.operationId, JSON.parse(queuedRaw ?? "{}").operationId);
  assert.equal(calls[0]?.expectedDraftVersion, 2);
  assert.deepEqual(calls[0]?.targetPayloadHashes, [SUBMITTED_HASH]);
  assert.equal(storage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);
});

test("같은 본문이 다른 version으로 남았으면 그 version으로 다시 지우고, 다른 본문은 남긴다", async () => {
  const storage = new MemoryStorage();
  const sourceKey = seedSubmittedDiscard(storage);
  const calls: DiscardDocumentServerDraftInput[] = [];
  let server: DocumentServerDraftSnapshot | null = snapshot(sourceKey, SUBMITTED_HASH, 3);

  const rebased = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    createOperationId: () => REBASE_OPERATION_ID,
    discard: async (input): Promise<DocumentServerDraftMutationResult> => {
      calls.push(input);
      if (server && server.draftVersion !== input.expectedDraftVersion) {
        return { ok: false, reason: "VERSION_CONFLICT", current: server };
      }
      server = null;
      return { ok: true, replayed: false, operationResultVersion: input.expectedDraftVersion, current: null };
    },
  });

  assert.deepEqual(rebased, { attempted: 1, discarded: 1, timedOut: false });
  assert.deepEqual(calls.map((call) => call.expectedDraftVersion), [2, 3]);
  assert.equal(calls[1]?.operationId, REBASE_OPERATION_ID);
  assert.equal(server, null);

  seedSubmittedDiscard(storage);
  const edited = snapshot(sourceKey, OTHER_HASH, 3);
  const kept = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    discard: async () => ({ ok: false, reason: "VERSION_CONFLICT", current: edited }),
  });

  assert.deepEqual(kept, { attempted: 1, discarded: 0, timedOut: false });
  assert.equal(storage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);
});

test("앞선 요청의 재실행 성공 뒤 같은 본문이 다시 저장돼 있으면 그 version으로 다시 지운다", async () => {
  const storage = new MemoryStorage();
  const sourceKey = seedSubmittedDiscard(storage);
  let server: DocumentServerDraftSnapshot | null = snapshot(sourceKey, SUBMITTED_HASH, 4);
  const calls: DiscardDocumentServerDraftInput[] = [];

  const result = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    createOperationId: () => REBASE_OPERATION_ID,
    discard: async (input): Promise<DocumentServerDraftMutationResult> => {
      calls.push(input);
      if (input.operationId !== REBASE_OPERATION_ID) {
        // 이전 시도가 이미 지웠고, 그 뒤 다른 기기가 같은 본문을 version 4로 다시 저장했다.
        return { ok: true, replayed: true, operationResultVersion: 2, current: server };
      }
      server = null;
      return { ok: true, replayed: false, operationResultVersion: 4, current: null };
    },
  });

  assert.deepEqual(result, { attempted: 1, discarded: 1, timedOut: false });
  assert.deepEqual(calls.map((call) => call.expectedDraftVersion), [2, 4]);
  assert.equal(server, null);
});

test("요청 실패는 로그아웃을 막지 않고, 응답이 없으면 시간 상한에서 멈춘다", async () => {
  const failedStorage = new MemoryStorage();
  const failedSource = seedSubmittedDiscard(failedStorage);
  const failed = await flushQueuedDocumentServerDraftDiscards({
    storage: failedStorage,
    ownerId: "student-1",
    discard: async () => {
      throw new Error("network unavailable");
    },
  });
  assert.deepEqual(failed, { attempted: 1, discarded: 0, timedOut: false });
  assert.ok(failedStorage.getItem(createDocumentServerDraftQueueKey(failedSource)));

  const hangingStorage = new MemoryStorage();
  seedSubmittedDiscard(hangingStorage);
  const startedAt = Date.now();
  let hangingSignal: AbortSignal | undefined;
  const hanging = await flushQueuedDocumentServerDraftDiscards({
    storage: hangingStorage,
    ownerId: "student-1",
    timeoutMs: 30,
    discard: (_input, signal) => {
      hangingSignal = signal;
      return new Promise(() => {});
    },
  });
  assert.deepEqual(hanging, { attempted: 1, discarded: 0, timedOut: true });
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(hangingSignal?.aborted, true, "시간 상한에서 보내던 요청을 끊어야 합니다.");

  const empty = await flushQueuedDocumentServerDraftDiscards({
    storage: new MemoryStorage(),
    ownerId: "student-1",
    discard: async () => assert.fail("대기열이 없으면 요청하지 않는다"),
  });
  assert.deepEqual(empty, { attempted: 0, discarded: 0, timedOut: false });
});

test("제출 정리의 폐기는 전송 중이던 이전 입력의 서버본을 hash로 겨냥해 그 version으로 다시 지우고 fence 대상을 그대로 보낸다", async () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1", "new");
  const superseded = ["2b1d6c7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"];
  // 제출 정리는 제출 본문과 전송 중이던 이전 입력(OTHER_HASH)의 본문 hash를 함께 대상에 넣는다.
  enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
    targetPayloadHashes: [SUBMITTED_HASH, OTHER_HASH],
    supersededOperationIds: superseded,
  });
  // 전송 중이던 이전 입력이 제출 뒤 늦게 반영돼 이 기기 이름으로 v1이 남았다.
  let server: DocumentServerDraftSnapshot | null = snapshot(sourceKey, OTHER_HASH, 1);
  const calls: DiscardDocumentServerDraftInput[] = [];

  const result = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    createOperationId: () => REBASE_OPERATION_ID,
    discard: async (input): Promise<DocumentServerDraftMutationResult> => {
      calls.push(input);
      if (server && (server.draftVersion !== input.expectedDraftVersion ||
        (input.targetPayloadHashes && !input.targetPayloadHashes.includes(server.payloadHash)))) {
        return { ok: false, reason: "VERSION_CONFLICT", current: server };
      }
      server = null;
      return { ok: true, replayed: false, operationResultVersion: input.expectedDraftVersion, current: null };
    },
  });

  assert.deepEqual(result, { attempted: 1, discarded: 1, timedOut: false });
  assert.deepEqual(calls.map((call) => call.expectedDraftVersion), [0, 1]);
  assert.deepEqual(calls[1]?.targetPayloadHashes, [SUBMITTED_HASH, OTHER_HASH]);
  assert.deepEqual(calls.map((call) => call.supersededOperationIds), [superseded, superseded]);
  assert.equal(server, null);
});

test("제출 정리의 폐기는 같은 기기 ID를 쓰는 다른 탭의 후속 작업(v2·다른 hash)을 폐기하지 않는다", async () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1", "new");
  enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 1,
    targetPayloadHashes: [SUBMITTED_HASH, OTHER_HASH],
    supersededOperationIds: ["2b1d6c7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"],
  });
  // 같은 브라우저의 탭 B가 그 사이 새 본문을 v2로 저장했다(writerDeviceId는 탭 A와 같다).
  const tabB = snapshot(sourceKey, "c".repeat(64), 2);
  assert.equal(tabB.writerDeviceId, DEVICE_ID);
  const calls: DiscardDocumentServerDraftInput[] = [];
  const kept = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    discard: async (input) => {
      calls.push(input);
      return { ok: false, reason: "VERSION_CONFLICT", current: tabB };
    },
  });
  assert.deepEqual(kept, { attempted: 1, discarded: 0, timedOut: false });
  assert.equal(calls.length, 1, "기기 ID가 같다는 이유로 v2·다른 본문을 다시 겨냥하지 않는다");
  assert.equal(storage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);

  // 다른 기기가 쓴 다른 본문도 그대로 둔다.
  enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
    targetPayloadHashes: [SUBMITTED_HASH],
  });
  const peer = { ...snapshot(sourceKey, OTHER_HASH, 1), writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0" };
  const peerKept = await flushQueuedDocumentServerDraftDiscards({
    storage,
    ownerId: "student-1",
    discard: async () => ({ ok: false, reason: "VERSION_CONFLICT", current: peer }),
  });
  assert.deepEqual(peerKept, { attempted: 1, discarded: 0, timedOut: false });
});
