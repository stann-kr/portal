import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_SERVER_DRAFT_QUEUE_TTL_MS,
  createDocumentServerDraftDeviceStorageKey,
  enqueueDocumentServerDraftDiscard,
  enqueueDocumentServerDraftUpsert,
  getOrCreateDocumentServerDraftDeviceId,
  parseQueuedDocumentServerDraft,
  readQueuedDocumentServerDraft,
  removeQueuedDocumentServerDraftIfUnchanged,
} from "./document-server-draft-queue";
import {
  createDocumentDraftKey,
  createDocumentServerDraftQueueKey,
  readDocumentDraftArtifact,
} from "./form-draft";
import { removeLocalDocumentDraftsForOwner } from "./local-document-drafts";

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
const NOW = Date.now();

test("같은 서버 초안 재시도는 operation ID와 raw queue를 유지한다", () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const first = enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { title: "같은 초안", contentHtml: "<p>본문</p>" },
    expectedDraftVersion: 2,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
    now: NOW,
  });
  const retry = enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { contentHtml: "<p>본문</p>", title: "같은 초안" },
    expectedDraftVersion: 2,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
    now: NOW + 100,
  });

  assert.equal(retry.raw, first.raw);
  assert.equal(retry.entry.operationId, first.entry.operationId);
  assert.equal(retry.entry.queuedAt, NOW);
});

test("내용 또는 CAS 기준이 달라지면 최신 의도 하나로 합치고 operation ID를 회전한다", () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("community-post", "student-1");
  const first = enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { title: "첫 입력" },
    expectedDraftVersion: 0,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
  });
  const changed = enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { title: "최신 입력" },
    expectedDraftVersion: 0,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
  });
  const rebased = enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { title: "최신 입력" },
    expectedDraftVersion: 3,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
  });

  assert.notEqual(changed.entry.operationId, first.entry.operationId);
  assert.notEqual(rebased.entry.operationId, changed.entry.operationId);
  assert.equal(readQueuedDocumentServerDraft(storage, sourceKey)?.raw, rebased.raw);
  assert.equal(storage.length, 1);
});

test("응답 대상 raw가 현재 queue와 같을 때만 CAS 제거한다", () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1");
  const first = enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { title: "첫 입력" },
    expectedDraftVersion: 0,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
  });
  const latest = enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
  });

  assert.equal(
    removeQueuedDocumentServerDraftIfUnchanged(storage, sourceKey, first.raw),
    false,
  );
  assert.equal(readQueuedDocumentServerDraft(storage, sourceKey)?.raw, latest.raw);
  assert.equal(
    removeQueuedDocumentServerDraftIfUnchanged(storage, sourceKey, latest.raw),
    true,
  );
  assert.equal(readQueuedDocumentServerDraft(storage, sourceKey), null);
});

test("제출 초안 삭제는 본문 범위를 재시도에 보존하고 범위가 바뀌면 새 작업으로 구분한다", () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "submitted-note");
  const input = { sourceKey, expectedDraftVersion: 2, targetPayloadHashes: ["a".repeat(64)] };
  const first = enqueueDocumentServerDraftDiscard(storage, input);
  assert.equal(enqueueDocumentServerDraftDiscard(storage, input).raw, first.raw);
  const parsed = parseQueuedDocumentServerDraft(first.raw);
  assert.ok(parsed?.operationType === "DISCARD");
  assert.deepEqual(parsed.targetPayloadHashes, input.targetPayloadHashes);
  const other = enqueueDocumentServerDraftDiscard(storage, { ...input, targetPayloadHashes: ["b".repeat(64)] });
  assert.notEqual(other.entry.operationId, first.entry.operationId);
  assert.equal(parseQueuedDocumentServerDraft(JSON.stringify({ ...first.entry, targetPayloadHashes: ["invalid"] })), null);
});

test("queue parser는 source 위조, 비정규 payload, 미래 version을 실행하지 않는다", () => {
  const sourceKey = createDocumentDraftKey("qna-reply", "student-1", "thread-1");
  const raw = JSON.stringify({
    version: 1,
    sourceKey,
    operationType: "UPSERT",
    operationId: "1f08d7f0-2468-4a3c-99f0-4e9b84899f0a",
    expectedDraftVersion: 0,
    queuedAt: 1,
    conflictCount: 0,
    payloadJson: '{"z":1,"a":2}',
    payloadHash: "0".repeat(64),
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
  });

  assert.equal(parseQueuedDocumentServerDraft(raw), null);
  assert.equal(
    parseQueuedDocumentServerDraft(
      raw.replace('"version":1', '"version":2'),
    ),
    null,
  );
  assert.equal(
    parseQueuedDocumentServerDraft(raw, createDocumentDraftKey("note", "student-2")),
    null,
  );
});

test("30일이 지난 오프라인 queue는 다시 실행하지 않는다", () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "expired-queue");
  enqueueDocumentServerDraftUpsert(storage, {
    sourceKey,
    data: { title: "만료된 입력" },
    expectedDraftVersion: 0,
    baseResourceVersion: null,
    writerDeviceId: DEVICE_ID,
    now: NOW,
  });

  assert.ok(readQueuedDocumentServerDraft(storage, sourceKey, NOW));
  assert.equal(
    readQueuedDocumentServerDraft(
      storage,
      sourceKey,
      NOW + DOCUMENT_SERVER_DRAFT_QUEUE_TTL_MS,
    ),
    null,
  );
});

test("계정 경계 정리는 해당 owner queue와 계정별 기기 ID만 지운다", () => {
  const storage = new MemoryStorage();
  const ownerSource = createDocumentDraftKey("note", "student-1", "note-1");
  const otherSource = createDocumentDraftKey("note", "student-2", "note-2");
  enqueueDocumentServerDraftDiscard(storage, {
    sourceKey: ownerSource,
    expectedDraftVersion: 1,
  });
  enqueueDocumentServerDraftDiscard(storage, {
    sourceKey: otherSource,
    expectedDraftVersion: 1,
  });
  const ownerDeviceKey = createDocumentServerDraftDeviceStorageKey("student-1");
  const otherDeviceKey = createDocumentServerDraftDeviceStorageKey("student-2");
  storage.setItem(ownerDeviceKey, DEVICE_ID);
  storage.setItem(otherDeviceKey, "7971deed-89f6-48a4-8bbd-5f0ec63488e0");

  assert.equal(
    readDocumentDraftArtifact(createDocumentServerDraftQueueKey(ownerSource))
      ?.artifactKind,
    "server-queue",
  );
  const result = removeLocalDocumentDraftsForOwner(storage, "student-1");

  assert.deepEqual(result.failedKeys, []);
  assert.equal(storage.getItem(createDocumentServerDraftQueueKey(ownerSource)), null);
  assert.ok(storage.getItem(createDocumentServerDraftQueueKey(otherSource)));
  assert.equal(storage.getItem(ownerDeviceKey), null);
  assert.ok(storage.getItem(otherDeviceKey));
  const regenerated = getOrCreateDocumentServerDraftDeviceId(storage, "student-1");
  assert.notEqual(regenerated, DEVICE_ID);
  assert.equal(storage.getItem(ownerDeviceKey), regenerated);
});

test("제출 정리 DISCARD는 이전 입력의 본문 hash와 fence 대상 operation ID를 보존하고 그 차이도 새 의도로 본다", () => {
  const storage = new MemoryStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const superseded = ["2b1d6c7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", "0c3f1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f"];
  const submittedHash = "a".repeat(64);
  const inflightHash = "b".repeat(64);
  const plain = enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
    targetPayloadHashes: [submittedHash],
  });
  // 제출 정리: 전송 중이던 이전 입력은 본문 hash(대상)와 operation ID(서버 fence)로 함께 겨냥한다.
  const own = enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
    targetPayloadHashes: [submittedHash, inflightHash],
    supersededOperationIds: superseded,
  });
  assert.notEqual(own.raw, plain.raw);
  const parsed = parseQueuedDocumentServerDraft(own.raw, sourceKey);
  assert.equal(parsed?.operationType, "DISCARD");
  if (parsed?.operationType !== "DISCARD") return;
  assert.deepEqual(parsed.targetPayloadHashes, [submittedHash, inflightHash]);
  assert.deepEqual(parsed.supersededOperationIds, [...superseded].sort());
  assert.equal("ownWriterDeviceId" in parsed, false, "기기 ID는 폐기 범위를 넓히는 근거가 아니므로 큐에 두지 않는다");

  const same = enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
    targetPayloadHashes: [inflightHash, submittedHash],
    supersededOperationIds: [...superseded].reverse(),
  });
  assert.equal(same.raw, own.raw, "같은 의도는 operation ID를 돌리지 않는다");

  assert.throws(() => enqueueDocumentServerDraftDiscard(storage, {
    sourceKey,
    expectedDraftVersion: 0,
    supersededOperationIds: Array.from({ length: 9 }, (_, index) => `2b1d6c7e-1a2b-4c3d-8e9f-0a1b2c3d4e${index}0`),
  }));
  // 이전 판의 기기 ID 필드는 더 이상 읽지 않는다(있어도 무시, 없어도 같은 의도).
  const legacy = parseQueuedDocumentServerDraft(JSON.stringify({ ...parsed, ownWriterDeviceId: DEVICE_ID }), sourceKey);
  assert.deepEqual(legacy, parsed);
  assert.equal(parseQueuedDocumentServerDraft(JSON.stringify({ ...parsed, supersededOperationIds: [] }), sourceKey), null);
});
