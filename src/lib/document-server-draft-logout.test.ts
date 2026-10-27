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
  const hanging = await flushQueuedDocumentServerDraftDiscards({
    storage: hangingStorage,
    ownerId: "student-1",
    timeoutMs: 30,
    discard: () => new Promise(() => {}),
  });
  assert.deepEqual(hanging, { attempted: 1, discarded: 0, timedOut: true });
  assert.ok(Date.now() - startedAt < 1_000);

  const empty = await flushQueuedDocumentServerDraftDiscards({
    storage: new MemoryStorage(),
    ownerId: "student-1",
    discard: async () => assert.fail("대기열이 없으면 요청하지 않는다"),
  });
  assert.deepEqual(empty, { attempted: 0, discarded: 0, timedOut: false });
});
