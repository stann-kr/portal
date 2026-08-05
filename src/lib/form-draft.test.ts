import assert from "node:assert/strict";
import test from "node:test";
import {
  FORM_DRAFT_CLEAR_MARKER_TTL_MS,
  FORM_DRAFT_CLEAR_MARKER_VERSION,
  FORM_DRAFT_MAX_DIVERGENT_RECOVERIES,
  FORM_DRAFT_RECOVERY_RECENT_MS,
  FORM_DRAFT_STORAGE_VERSION,
  FORM_DRAFT_RECOVERY_TTL_MS,
  compactFormDraftRecoveries,
  createFormDraftDataSignature,
  createFormDraftRecoveryPreview,
  createDocumentDraftKey,
  createImmutableFormDraftRecoveryKey,
  createFormDraftClearMarkerEntryKey,
  createFormDraftClearMarkerEntryPrefix,
  createFormDraftClearMarkerKey,
  createFormDraftRecoveryKey,
  findFormDraftClearMarker,
  hasFutureFormDraftVersion,
  hasFormDraftStorageConflict,
  isFormDraftRecoveryKey,
  parseFormDraft,
  persistFormDraftRawSnapshot,
  persistFormDraftSnapshot,
  pruneFormDraftClearMarker,
  pruneFormDraftRecoveries,
  readFormDraftClearMarker,
  readFormDraftClearMarkers,
  readFormDraftRecovery,
  removeFormDraftCanonicalSnapshotBySignature,
  removeFormDraftClearMarker,
  removeFormDraftSnapshotsBySignature,
  serializeFormDraft,
  writeFormDraftClearMarker,
} from "./form-draft";

class MemoryDraftStorage {
  protected readonly values = new Map<string, string>();
  readonly writes: string[] = [];

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
    this.writes.push(key);
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class CanonicalOverwriteStorage extends MemoryDraftStorage {
  private overwriteOnCanonicalWrite = false;

  constructor(
    private readonly canonicalKey: string,
    private readonly overwriteRaw: string,
  ) {
    super();
  }

  enableCanonicalOverwrite() {
    this.overwriteOnCanonicalWrite = true;
  }

  override setItem(key: string, value: string) {
    super.setItem(key, value);
    if (this.overwriteOnCanonicalWrite && key === this.canonicalKey) {
      this.overwriteOnCanonicalWrite = false;
      super.setItem(key, this.overwriteRaw);
    }
  }
}

class RecoveryChangesBeforeRemovalStorage extends MemoryDraftStorage {
  private targetReads = 0;

  constructor(
    private readonly targetKey: string,
    private readonly replacementRaw: string,
  ) {
    super();
  }

  override getItem(key: string) {
    if (key === this.targetKey) {
      this.targetReads += 1;
      if (this.targetReads === 2) super.setItem(key, this.replacementRaw);
    }
    return super.getItem(key);
  }
}

function writeImmutableRecovery<T>(
  storage: MemoryDraftStorage,
  sourceKey: string,
  writerId: string,
  data: T,
  savedAt: number,
  retainedAt?: number,
): string {
  const raw = serializeFormDraft(data, savedAt, retainedAt);
  const recoveryKey = createImmutableFormDraftRecoveryKey(sourceKey, writerId, raw);
  storage.setItem(recoveryKey, raw);
  return recoveryKey;
}

test("version과 저장 시각을 포함해 draft를 왕복한다", () => {
  const raw = serializeFormDraft({ title: "연습 기록" }, 1_786_000_000_000);
  const parsed = parseFormDraft<{ title: string }>(raw);

  assert.deepEqual(parsed, {
    data: { title: "연습 기록" },
    savedAt: new Date(1_786_000_000_000),
    legacy: false,
  });
  assert.equal(JSON.parse(raw).version, FORM_DRAFT_STORAGE_VERSION);
});

test("기존 raw JSON draft도 복원한다", () => {
  assert.deepEqual(parseFormDraft<{ title: string }>(JSON.stringify({ title: "이전 초안" })), {
    data: { title: "이전 초안" },
    savedAt: null,
    legacy: true,
  });
});

test("손상되었거나 알 수 없는 version의 draft는 무시한다", () => {
  const futureRaw = JSON.stringify({ version: 99, savedAt: 1, data: {} });
  assert.equal(parseFormDraft("{"), null);
  assert.equal(parseFormDraft(futureRaw), null);
  assert.equal(hasFutureFormDraftVersion(futureRaw), true);
  assert.equal(hasFutureFormDraftVersion("{"), false);
});

test("문서 draft key는 사용자와 문서 문맥을 분리한다", () => {
  assert.equal(
    createDocumentDraftKey("note", "student:1", "new"),
    "draft:document:note:student%3A1:new",
  );
  assert.notEqual(
    createDocumentDraftKey("qna-reply", "student-1", "thread-a"),
    createDocumentDraftKey("qna-reply", "student-2", "thread-a"),
  );
});

test("복구 preview는 제목과 HTML 본문을 짧은 안전한 평문으로 만든다", () => {
  const preview = createFormDraftRecoveryPreview({
    title: "<strong> 8월 수업 기록 </strong>\u202e",
    contentHtml:
      '<p>첫&nbsp;문장 &amp; 둘째 문장</p><script>alert("노출 금지")</script>',
  });

  assert.deepEqual(preview, {
    title: "8월 수업 기록",
    body: "첫 문장 & 둘째 문장",
  });
  assert.equal(preview.body?.includes("script"), false);
  assert.equal(preview.body?.includes("alert"), false);
  assert.deepEqual(
    createFormDraftRecoveryPreview({
      contentHtml: '<p>보존할 본문</p><script>alert("잘린 태그")',
    }),
    { title: null, body: "보존할 본문" },
  );
});

test("텍스트가 없는 복구본은 embed와 첨부 여부를 사람용 preview로 표시한다", () => {
  assert.deepEqual(
    createFormDraftRecoveryPreview({
      contentHtml: '<p><img src="x"><iframe src="x"></iframe></p>',
    }),
    { title: null, body: "이미지 포함 · 동영상 포함" },
  );
  assert.deepEqual(
    createFormDraftRecoveryPreview({ attachmentUrl: "https://example.com/file.pdf" }),
    { title: null, body: "첨부 파일 포함" },
  );
});

test("복구 preview는 긴 Unicode 본문을 고정 길이에서 말줄임한다", () => {
  const preview = createFormDraftRecoveryPreview({
    contentHtml: `<p>${"🎧".repeat(200)}</p>`,
  });

  assert.equal(Array.from(preview.body ?? "").length, 160);
  assert.equal(preview.body?.endsWith("…"), true);
});

test("복구 preview는 큰 문서의 작은 선두 구간만 검사한다", () => {
  const preview = createFormDraftRecoveryPreview({
    title: `${" ".repeat(512)}검사 범위 밖 제목`,
    contentHtml: `${" ".repeat(4_096)}<img src="scan-cap-outside">`,
  });

  assert.deepEqual(preview, { title: null, body: null });
});

test("다른 탭이 draft를 쓰거나 지운 경우 storage 충돌로 판정한다", () => {
  assert.equal(hasFormDraftStorageConflict("old", "old"), false);
  assert.equal(hasFormDraftStorageConflict(null, null), false);
  assert.equal(hasFormDraftStorageConflict("old", "new"), true);
  assert.equal(hasFormDraftStorageConflict("old", null), true);
  assert.equal(hasFormDraftStorageConflict(null, "new"), true);
});

test("draft data signature는 저장 시각과 object key 순서에 영향받지 않는다", () => {
  const longContent = "민감한 본문".repeat(10_000);
  const compactSignature = createFormDraftDataSignature({ contentHtml: longContent });
  assert.equal(
    createFormDraftDataSignature({ title: "연습", nested: { content: "A", order: 1 } }),
    createFormDraftDataSignature({ nested: { order: 1, content: "A" }, title: "연습" }),
  );
  assert.notEqual(
    createFormDraftDataSignature({ title: "연습 A" }),
    createFormDraftDataSignature({ title: "연습 B" }),
  );
  assert.match(compactSignature, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(compactSignature.includes("민감한 본문"), false);
});

test("복구본 key는 원본 문서별 namespace와 탭별 id를 분리한다", () => {
  const noteKey = createDocumentDraftKey("note", "student-1", "note-1");
  const otherKey = createDocumentDraftKey("note", "student-1", "note-2");
  const recoveryKey = createFormDraftRecoveryKey(noteKey, "tab:1");

  assert.equal(isFormDraftRecoveryKey(noteKey, recoveryKey), true);
  assert.equal(isFormDraftRecoveryKey(otherKey, recoveryKey), false);
  assert.match(recoveryKey, /tab%3A1$/u);
});

test("clear marker는 version과 signature를 recovery 보존 기간 동안 문서별로 격리한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const otherSourceKey = createDocumentDraftKey("note", "student-1", "note-2");
  const clearedAt = 1_800_000_000_000;
  const signature = createFormDraftDataSignature({ title: "제출 완료" });

  const written = writeFormDraftClearMarker(storage, sourceKey, signature, clearedAt);
  const marker = readFormDraftClearMarker(
    storage,
    sourceKey,
    clearedAt + FORM_DRAFT_CLEAR_MARKER_TTL_MS,
  );

  assert.equal(written.version, FORM_DRAFT_CLEAR_MARKER_VERSION);
  assert.equal(FORM_DRAFT_CLEAR_MARKER_TTL_MS, FORM_DRAFT_RECOVERY_TTL_MS);
  assert.ok(written.raw.length < 200);
  assert.equal(marker?.signature, signature);
  assert.equal(marker?.clearedAt.getTime(), clearedAt);
  assert.equal(readFormDraftClearMarker(storage, otherSourceKey, clearedAt), null);
  assert.notEqual(
    createFormDraftClearMarkerKey(sourceKey),
    createFormDraftClearMarkerKey(otherSourceKey),
  );
  assert.equal(
    readFormDraftClearMarker(
      storage,
      sourceKey,
      clearedAt + FORM_DRAFT_CLEAR_MARKER_TTL_MS + 1,
    ),
    null,
  );
});

test("canonical 제출 정리는 signature·cutoff·CAS가 모두 맞을 때만 삭제한다", () => {
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-canonical-clear");
  const submittedData = { title: "제출 완료", contentHtml: "<p>본문</p>" };
  const divergentData = { title: "이어 쓴 내용", contentHtml: "<p>새 본문</p>" };
  const submittedSignature = createFormDraftDataSignature(submittedData);
  const submittedAt = 1_800_000_001_000;
  const storage = new MemoryDraftStorage();

  storage.setItem(sourceKey, serializeFormDraft(submittedData, submittedAt - 1));
  assert.equal(
    removeFormDraftCanonicalSnapshotBySignature(
      storage,
      sourceKey,
      submittedSignature,
      { savedAtOrBefore: submittedAt },
    ),
    true,
  );
  assert.equal(storage.getItem(sourceKey), null);

  const newerRaw = serializeFormDraft(submittedData, submittedAt + 1);
  storage.setItem(sourceKey, newerRaw);
  assert.equal(
    removeFormDraftCanonicalSnapshotBySignature(
      storage,
      sourceKey,
      submittedSignature,
      { savedAtOrBefore: submittedAt },
    ),
    false,
  );
  assert.equal(storage.getItem(sourceKey), newerRaw);

  const divergentRaw = serializeFormDraft(divergentData, submittedAt - 1);
  storage.setItem(sourceKey, divergentRaw);
  assert.equal(
    removeFormDraftCanonicalSnapshotBySignature(
      storage,
      sourceKey,
      submittedSignature,
      { savedAtOrBefore: submittedAt },
    ),
    false,
  );
  assert.equal(storage.getItem(sourceKey), divergentRaw);

  const futureRaw = JSON.stringify({
    version: FORM_DRAFT_STORAGE_VERSION + 1,
    savedAt: submittedAt - 1,
    data: submittedData,
  });
  storage.setItem(sourceKey, futureRaw);
  assert.equal(
    removeFormDraftCanonicalSnapshotBySignature(
      storage,
      sourceKey,
      submittedSignature,
      { savedAtOrBefore: submittedAt },
    ),
    false,
  );
  assert.equal(storage.getItem(sourceKey), futureRaw);
});

test("연속 제출 marker는 signature별 entry로 보존하고 legacy head 덮어쓰기와 공존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "new");
  const baseTime = 1_800_000_000_000;
  const firstSignature = createFormDraftDataSignature({ title: "첫 제출" });
  const secondSignature = createFormDraftDataSignature({ title: "둘째 제출" });
  const legacySignature = createFormDraftDataSignature({ title: "구버전 제출" });

  storage.setItem(
    createFormDraftClearMarkerKey(sourceKey),
    JSON.stringify({
      version: FORM_DRAFT_CLEAR_MARKER_VERSION,
      signature: firstSignature,
      clearedAt: baseTime,
    }),
  );
  writeFormDraftClearMarker(storage, sourceKey, secondSignature, baseTime + 1_000);
  storage.setItem(
    createFormDraftClearMarkerKey(sourceKey),
    JSON.stringify({
      version: FORM_DRAFT_CLEAR_MARKER_VERSION,
      signature: legacySignature,
      clearedAt: baseTime + 2_000,
    }),
  );

  const markers = readFormDraftClearMarkers(storage, sourceKey, baseTime + 3_000);
  assert.deepEqual(
    markers.map((marker) => marker.signature),
    [legacySignature, secondSignature, firstSignature],
  );
  assert.equal(
    findFormDraftClearMarker(storage, sourceKey, firstSignature, baseTime + 3_000)
      ?.clearedAt.getTime(),
    baseTime,
  );
});

test("clear marker entry는 동일 signature 구형본만 정리하고 TTL 안의 unique 이력은 모두 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1", "new");
  const baseTime = 1_800_000_000_000;
  const repeatedSignature = createFormDraftDataSignature({ title: "반복 제출" });
  const olderRepeatedKey = createFormDraftClearMarkerEntryKey(
    sourceKey,
    repeatedSignature,
    baseTime,
  );
  writeFormDraftClearMarker(storage, sourceKey, repeatedSignature, baseTime);
  writeFormDraftClearMarker(storage, sourceKey, repeatedSignature, baseTime + 1);
  assert.equal(storage.getItem(olderRepeatedKey), null);

  const signatures = Array.from(
    { length: 65 },
    (_, index) => createFormDraftDataSignature({ title: `제출 ${index}` }),
  );
  signatures.forEach((signature, index) => {
    writeFormDraftClearMarker(storage, sourceKey, signature, baseTime + 10 + index);
  });

  const entryPrefix = createFormDraftClearMarkerEntryPrefix(sourceKey);
  const entryKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key?.startsWith(entryPrefix) ?? false);
  assert.equal(entryKeys.length, signatures.length + 1);
  assert.ok(
    findFormDraftClearMarker(
      storage,
      sourceKey,
      signatures[0]!,
      baseTime + 1_000,
    ),
  );
  assert.ok(
    findFormDraftClearMarker(
      storage,
      sourceKey,
      signatures.at(-1)!,
      baseTime + 1_000,
    ),
  );
});

test("만료되거나 손상된 clear marker는 접근 시 storage에서 제거한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-expired-marker");
  const markerKey = createFormDraftClearMarkerKey(sourceKey);
  const clearedAt = 1_800_000_000_000;
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature({ title: "만료" }),
    clearedAt,
  );

  assert.equal(
    pruneFormDraftClearMarker(
      storage,
      sourceKey,
      clearedAt + FORM_DRAFT_CLEAR_MARKER_TTL_MS + 1,
    ),
    null,
  );
  assert.equal(storage.getItem(markerKey), null);

  storage.setItem(markerKey, "손상 marker");
  assert.equal(pruneFormDraftClearMarker(storage, sourceKey, clearedAt), null);
  assert.equal(storage.getItem(markerKey), null);

  const futureMarkerRaw = JSON.stringify({
    version: FORM_DRAFT_CLEAR_MARKER_VERSION + 1,
    signature: "future",
    clearedAt,
  });
  storage.setItem(markerKey, futureMarkerRaw);
  assert.equal(pruneFormDraftClearMarker(storage, sourceKey, clearedAt), null);
  assert.equal(storage.getItem(markerKey), futureMarkerRaw);

  const futureEntryKey = createFormDraftClearMarkerEntryKey(
    sourceKey,
    "future-entry",
    clearedAt,
  );
  storage.setItem(futureEntryKey, futureMarkerRaw);
  assert.equal(pruneFormDraftClearMarker(storage, sourceKey, clearedAt), null);
  assert.equal(storage.getItem(futureEntryKey), futureMarkerRaw);

  const currentSignature = createFormDraftDataSignature({ title: "구버전 client 제출" });
  writeFormDraftClearMarker(storage, sourceKey, currentSignature, clearedAt + 1_000);
  assert.equal(storage.getItem(markerKey), futureMarkerRaw);
  assert.ok(
    findFormDraftClearMarker(
      storage,
      sourceKey,
      currentSignature,
      clearedAt + 2_000,
    ),
  );
});

test("clear marker 제거는 다른 문서 marker를 건드리지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1", "new");
  const otherSourceKey = createDocumentDraftKey("qna-thread", "student-2", "new");
  writeFormDraftClearMarker(storage, sourceKey, "first", 1_800_000_000_000);
  writeFormDraftClearMarker(storage, otherSourceKey, "second", 1_800_000_000_000);

  removeFormDraftClearMarker(storage, sourceKey);

  assert.equal(storage.getItem(createFormDraftClearMarkerKey(sourceKey)), null);
  assert.deepEqual(readFormDraftClearMarkers(storage, sourceKey, 1_800_000_000_000), []);
  assert.notEqual(storage.getItem(createFormDraftClearMarkerKey(otherSourceKey)), null);
  assert.equal(readFormDraftClearMarkers(storage, otherSourceKey, 1_800_000_000_000).length, 1);
});

test("복구본은 canonical mirror와 중복 data를 숨기되 storage에서 삭제하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("community-post", "author-1", "post-1");
  const otherSourceKey = createDocumentDraftKey("community-post", "author-1", "post-2");
  const now = 1_800_000_000_000;
  const mirrorKey = createFormDraftRecoveryKey(sourceKey, "mirror");
  const duplicateKey = createFormDraftRecoveryKey(sourceKey, "duplicate");

  storage.setItem(sourceKey, serializeFormDraft({ title: "canonical" }, now - 10_000));
  storage.setItem(mirrorKey, serializeFormDraft({ title: "canonical" }, now));
  for (let index = 0; index < 7; index += 1) {
    storage.setItem(
      createFormDraftRecoveryKey(sourceKey, `tab-${index}`),
      serializeFormDraft({ title: `복구 ${index}` }, now - index * 1000),
    );
  }
  storage.setItem(duplicateKey, serializeFormDraft({ title: "복구 0" }, now - 500));
  const expiredRaw = serializeFormDraft(
    { title: "만료" },
    now - FORM_DRAFT_RECOVERY_TTL_MS - 1,
  );
  const expiredKey = createImmutableFormDraftRecoveryKey(sourceKey, "expired", expiredRaw);
  const brokenRaw = "{";
  const brokenKey = createImmutableFormDraftRecoveryKey(sourceKey, "broken", brokenRaw);
  storage.setItem(expiredKey, expiredRaw);
  storage.setItem(brokenKey, brokenRaw);
  storage.setItem(
    createFormDraftRecoveryKey(otherSourceKey, "other"),
    serializeFormDraft({ title: "다른 문서" }, now),
  );

  const recoveries = pruneFormDraftRecoveries<{ title: string }>(storage, sourceKey, now);

  assert.equal(recoveries.length, 7);
  assert.equal(recoveries[0]?.data.title, "복구 0");
  assert.equal(recoveries.at(-1)?.data.title, "복구 6");
  assert.notEqual(storage.getItem(mirrorKey), null);
  assert.notEqual(storage.getItem(duplicateKey), null);
  assert.equal(storage.getItem(expiredKey), null);
  assert.equal(storage.getItem(brokenKey), null);
  assert.equal(isFormDraftRecoveryKey(otherSourceKey, recoveries[0]!.storageKey), false);
});

test("미래 version recovery는 구버전 compaction이 삭제하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-future-recovery");
  const recoveryKey = createFormDraftRecoveryKey(sourceKey, "future-writer");
  const futureRaw = JSON.stringify({
    version: FORM_DRAFT_STORAGE_VERSION + 1,
    savedAt: 1_800_000_000_000,
    data: { title: "미래 client 초안" },
  });
  storage.setItem(recoveryKey, futureRaw);

  assert.deepEqual(
    pruneFormDraftRecoveries(storage, sourceKey, 1_800_000_001_000),
    [],
  );
  assert.equal(storage.getItem(recoveryKey), futureRaw);
});

test("retention cap은 최신 unique divergent 20개와 protected 초과본을 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("community-post", "author-1", "post-1");
  const now = 1_800_000_000_000;
  const keys = Array.from(
    { length: FORM_DRAFT_MAX_DIVERGENT_RECOVERIES + 3 },
    (_, index) => writeImmutableRecovery(
      storage,
      sourceKey,
      `writer-${index}`,
      { title: `unique-${index}` },
      now - FORM_DRAFT_RECOVERY_RECENT_MS - 1 - index * 1000,
    ),
  );
  const protectedKey = keys.at(-1)!;
  const options = { now, protectedKeys: [protectedKey] };

  const compacted = compactFormDraftRecoveries(storage, sourceKey, options);
  const recoveries = pruneFormDraftRecoveries<{ title: string }>(storage, sourceKey, options);

  assert.equal(compacted.excessKeys.length, 2);
  assert.equal(recoveries.length, FORM_DRAFT_MAX_DIVERGENT_RECOVERIES + 1);
  assert.notEqual(storage.getItem(protectedKey), null);
  assert.equal(storage.getItem(keys[20]!), null);
  assert.equal(storage.getItem(keys[21]!), null);
});

test("retention cap은 causal savedAt이 아니라 durable retainedAt 최신순으로 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "retained-order");
  const now = 1_800_000_000_000;
  const newestRetainedAt = now - FORM_DRAFT_RECOVERY_RECENT_MS - 1_000;
  const longRunningKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "long-running",
    { title: "오래 작성했지만 최근 영속화" },
    now - FORM_DRAFT_RECOVERY_TTL_MS - 10_000,
    newestRetainedAt,
  );
  const competitorKeys = Array.from(
    { length: FORM_DRAFT_MAX_DIVERGENT_RECOVERIES },
    (_, index) => writeImmutableRecovery(
      storage,
      sourceKey,
      `competitor-${index}`,
      { title: `경쟁 복구본 ${index}` },
      now - 10_000 - index,
      newestRetainedAt - 1_000 - index,
    ),
  );

  const compacted = compactFormDraftRecoveries(storage, sourceKey, { now });

  assert.equal(compacted.excessKeys.length, 1);
  assert.notEqual(storage.getItem(longRunningKey), null);
  assert.equal(
    competitorKeys.filter((recoveryKey) => storage.getItem(recoveryKey) === null).length,
    1,
  );
});

test("최근 1시간 unique divergent는 20개를 넘어도 cap 정리하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("qna-reply", "student-1", "thread-1");
  const now = 1_800_000_000_000;
  const count = FORM_DRAFT_MAX_DIVERGENT_RECOVERIES + 5;
  for (let index = 0; index < count; index += 1) {
    storage.setItem(
      createFormDraftRecoveryKey(sourceKey, `recent-${index}`),
      serializeFormDraft({ contentHtml: `<p>${index}</p>` }, now - index * 1000),
    );
  }

  const compacted = compactFormDraftRecoveries(storage, sourceKey, { now });
  const recoveries = pruneFormDraftRecoveries<{ contentHtml: string }>(storage, sourceKey, { now });

  assert.equal(compacted.excessKeys.length, 0);
  assert.equal(recoveries.length, count);
});

test("오래된 물리 중복은 정리하되 최신·최근·protected mirror는 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const now = 1_800_000_000_000;
  const canonicalData = { title: "canonical" };
  storage.setItem(sourceKey, serializeFormDraft(canonicalData, now - 10_000));
  const recentKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "recent",
    canonicalData,
    now - 1000,
  );
  const oldDuplicateKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "old-duplicate",
    canonicalData,
    now - FORM_DRAFT_RECOVERY_RECENT_MS - 1000,
  );
  const olderDuplicateKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "older-duplicate",
    canonicalData,
    now - FORM_DRAFT_RECOVERY_RECENT_MS - 2000,
  );
  const protectedKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "protected",
    canonicalData,
    now - FORM_DRAFT_RECOVERY_RECENT_MS - 3000,
  );

  const compacted = compactFormDraftRecoveries(storage, sourceKey, {
    now,
    protectedKeys: [protectedKey],
  });
  const recoveries = pruneFormDraftRecoveries(storage, sourceKey, {
    now,
    protectedKeys: [protectedKey],
  });

  assert.deepEqual(
    new Set(compacted.duplicateKeys),
    new Set([oldDuplicateKey, olderDuplicateKey]),
  );
  assert.notEqual(storage.getItem(recentKey), null);
  assert.notEqual(storage.getItem(protectedKey), null);
  assert.equal(recoveries.length, 0);
});

test("동일 causal·retention 시각의 중복은 storage key로 같은 대표를 선택한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "stable-duplicate");
  const now = 1_800_000_000_000;
  const retainedAt = now - FORM_DRAFT_RECOVERY_RECENT_MS - 1_000;
  const firstKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "writer-a",
    { title: "동시 작성" },
    retainedAt,
    retainedAt,
  );
  const secondKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "writer-b",
    { title: "동시 작성" },
    retainedAt,
    retainedAt,
  );
  const expectedKey = [firstKey, secondKey].sort().at(-1)!;

  compactFormDraftRecoveries(storage, sourceKey, { now });

  assert.notEqual(storage.getItem(expectedKey), null);
  assert.equal(
    [firstKey, secondKey].filter((storageKey) => storage.getItem(storageKey) !== null)
      .length,
    1,
  );
});

test("canonical mirror는 canonical 교체 경합에 대비해 물리 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const now = 1_800_000_000_000;
  const data = { title: "canonical" };
  storage.setItem(sourceKey, serializeFormDraft(data, now - 1000));
  const mirrorKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "inactive-writer",
    data,
    now - FORM_DRAFT_RECOVERY_RECENT_MS - 1000,
  );

  const compacted = compactFormDraftRecoveries(storage, sourceKey, { now });

  assert.deepEqual(compacted.removedKeys, []);
  assert.notEqual(storage.getItem(mirrorKey), null);
  assert.notEqual(storage.getItem(sourceKey), null);
});

test("clear marker는 이전 동일 snapshot ghost를 숨기고 marker 이후 새 snapshot은 유지한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1", "new");
  const now = 1_800_000_000_000;
  const data = { title: "같은 제목", contentHtml: "<p>내용</p>" };
  const signature = createFormDraftDataSignature(data);
  const beforeKey = createFormDraftRecoveryKey(sourceKey, "before-clear");
  const afterKey = createFormDraftRecoveryKey(sourceKey, "after-clear");
  storage.setItem(beforeKey, serializeFormDraft(data, now - 20 * 60 * 1000));
  writeFormDraftClearMarker(storage, sourceKey, signature, now - 10 * 60 * 1000);

  assert.deepEqual(pruneFormDraftRecoveries(storage, sourceKey, { now }), []);
  assert.notEqual(storage.getItem(beforeKey), null);

  storage.setItem(afterKey, serializeFormDraft(data, now - 5 * 60 * 1000));
  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, { now });

  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0]?.storageKey, afterKey);
  assert.notEqual(storage.getItem(beforeKey), null);
});

test("retainedAt이 더 최신인 marker 이전 중복이 이후 유효 snapshot을 숨기지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("qna-thread", "student-1", "retained-marker");
  const now = 1_800_000_000_000;
  const data = { title: "같은 제목", contentHtml: "<p>같은 내용</p>" };
  const markerAt = now - 15 * 60 * 1000;
  const staleKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "stale",
    data,
    markerAt - 5 * 60 * 1000,
    now - 60 * 1000,
  );
  const liveKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "live",
    data,
    markerAt + 5 * 60 * 1000,
    now - 5 * 60 * 1000,
  );
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );

  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, { now });

  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [liveKey]);
  assert.notEqual(storage.getItem(staleKey), null);
  assert.notEqual(storage.getItem(liveKey), null);
});

test("오래된 marker 이전 중복을 정리해도 이후 유효 snapshot은 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "compact-marker");
  const now = 1_800_000_000_000;
  const data = { title: "동일 내용 재작성" };
  const markerAt = now - 4 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const staleKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "stale",
    data,
    markerAt - FORM_DRAFT_RECOVERY_RECENT_MS,
    now - 2 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  const liveKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "live",
    data,
    markerAt + FORM_DRAFT_RECOVERY_RECENT_MS,
    now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );

  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, { now });

  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [liveKey]);
  assert.equal(storage.getItem(staleKey), null);
  assert.notEqual(storage.getItem(liveKey), null);
});

test("marker 이전 stale canonical은 이후 동일 signature recovery를 가리지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "stale-canonical");
  const now = 1_800_000_000_000;
  const data = { title: "제출 후 다시 작성" };
  const markerAt = now - 4 * FORM_DRAFT_RECOVERY_RECENT_MS;
  storage.setItem(
    sourceKey,
    serializeFormDraft(data, markerAt - FORM_DRAFT_RECOVERY_RECENT_MS),
  );
  const liveKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "live",
    data,
    markerAt + FORM_DRAFT_RECOVERY_RECENT_MS,
    now - 2 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );

  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, { now });

  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [liveKey]);
  assert.notEqual(storage.getItem(liveKey), null);
});

test("compaction 뒤 생긴 marker도 causal 최신 동일 signature recovery를 남긴다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "future-marker-duplicate");
  const now = 1_800_000_000_000;
  const data = { title: "같은 내용의 연속 작성" };
  const staleSavedAt = now - 5 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const markerAt = now - 4 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const liveSavedAt = now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const staleKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "stale",
    data,
    staleSavedAt,
    now - 2 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  const liveKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "live",
    data,
    liveSavedAt,
    now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );

  compactFormDraftRecoveries(storage, sourceKey, { now });
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );
  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, { now });

  assert.equal(storage.getItem(staleKey), null);
  assert.notEqual(storage.getItem(liveKey), null);
  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [liveKey]);
});

test("cap은 protected 과거 중복만 남기고 causal 최신 대표를 따로 삭제하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "protected-cap-marker");
  const now = 1_800_000_000_000;
  const data = { title: "보호본과 최신본" };
  const oldSavedAt = now - 5 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const markerAt = now - 4 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const latestSavedAt = now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const protectedKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "protected-old",
    data,
    oldSavedAt,
    now - 2 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  const latestKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "causal-latest",
    data,
    latestSavedAt,
    now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );

  compactFormDraftRecoveries(storage, sourceKey, {
    now,
    maxDivergent: 0,
    protectedKeys: [protectedKey],
  });
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );
  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, {
    now,
    protectedKeys: [protectedKey],
  });

  assert.notEqual(storage.getItem(protectedKey), null);
  assert.notEqual(storage.getItem(latestKey), null);
  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [latestKey]);
});

test("cap은 marker로 숨은 protected 중복이 있어도 causal 최신 대표를 삭제하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "hidden-protected-cap");
  const now = 1_800_000_000_000;
  const data = { title: "숨은 보호본과 최신본" };
  const markerAt = now - 4 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const protectedKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "protected-old",
    data,
    markerAt - FORM_DRAFT_RECOVERY_RECENT_MS,
    now - 2 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  const latestKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "causal-latest",
    data,
    markerAt + FORM_DRAFT_RECOVERY_RECENT_MS,
    now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );

  compactFormDraftRecoveries(storage, sourceKey, {
    now,
    maxDivergent: 0,
    protectedKeys: [protectedKey],
  });
  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, {
    now,
    maxDivergent: 0,
    protectedKeys: [protectedKey],
  });

  assert.notEqual(storage.getItem(protectedKey), null);
  assert.notEqual(storage.getItem(latestKey), null);
  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [latestKey]);
});

test("compaction 뒤 생긴 marker도 stale canonical보다 최신인 mirror를 남긴다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "future-marker-canonical");
  const now = 1_800_000_000_000;
  const data = { title: "canonical 뒤 동일 내용 재작성" };
  const canonicalSavedAt = now - 5 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const markerAt = now - 4 * FORM_DRAFT_RECOVERY_RECENT_MS;
  const liveKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "live",
    data,
    now - 3 * FORM_DRAFT_RECOVERY_RECENT_MS,
    now - 2 * FORM_DRAFT_RECOVERY_RECENT_MS,
  );
  storage.setItem(sourceKey, serializeFormDraft(data, canonicalSavedAt));

  compactFormDraftRecoveries(storage, sourceKey, { now });
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    markerAt,
  );
  const recoveries = pruneFormDraftRecoveries<typeof data>(storage, sourceKey, { now });

  assert.notEqual(storage.getItem(liveKey), null);
  assert.deepEqual(recoveries.map((recovery) => recovery.storageKey), [liveKey]);
});

test("서로 다른 연속 제출 marker는 각 signature의 cutoff 이전 recovery만 숨긴다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("community-post", "author-1", "new");
  const now = 1_800_000_010_000;
  const firstData = { title: "첫 제출" };
  const secondData = { title: "둘째 제출" };
  const firstBeforeKey = createFormDraftRecoveryKey(sourceKey, "first-before");
  const firstAfterKey = createFormDraftRecoveryKey(sourceKey, "first-after");
  const secondBeforeKey = createFormDraftRecoveryKey(sourceKey, "second-before");
  const secondAfterKey = createFormDraftRecoveryKey(sourceKey, "second-after");
  storage.setItem(firstBeforeKey, serializeFormDraft(firstData, now - 4_000));
  storage.setItem(firstAfterKey, serializeFormDraft(firstData, now - 2_000));
  storage.setItem(secondBeforeKey, serializeFormDraft(secondData, now - 3_000));
  storage.setItem(secondAfterKey, serializeFormDraft(secondData, now - 1_000));
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(firstData),
    now - 3_000,
  );
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(secondData),
    now - 2_000,
  );

  const recoveries = pruneFormDraftRecoveries<typeof firstData>(storage, sourceKey, { now });

  assert.deepEqual(
    new Set(recoveries.map((recovery) => recovery.storageKey)),
    new Set([firstAfterKey, secondAfterKey]),
  );
  assert.notEqual(storage.getItem(firstBeforeKey), null);
  assert.notEqual(storage.getItem(secondBeforeKey), null);
});

test("최근·protected가 아닌 marker 이전 ghost는 quota compaction에서 제거한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("community-post", "author-1", "new");
  const now = 1_800_000_000_000;
  const data = { title: "제출 완료" };
  const ghostKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "old-ghost",
    data,
    now - FORM_DRAFT_RECOVERY_RECENT_MS - 60_000,
  );
  writeFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(data),
    now - FORM_DRAFT_RECOVERY_RECENT_MS,
  );

  const compacted = compactFormDraftRecoveries(storage, sourceKey, { now });

  assert.deepEqual(compacted.resolvedMarkerKeys, [ghostKey]);
  assert.equal(storage.getItem(ghostKey), null);
});

test("선택한 recovery는 읽은 뒤에도 삭제하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const recoveryKey = createFormDraftRecoveryKey(sourceKey, "writer-1");
  const raw = serializeFormDraft({ title: "되살릴 초안" }, 1_800_000_000_000);
  storage.setItem(recoveryKey, raw);

  const recovery = readFormDraftRecovery<{ title: string }>(
    storage,
    sourceKey,
    recoveryKey,
    1_800_000_001_000,
  );

  assert.equal(recovery?.data.title, "되살릴 초안");
  assert.equal(storage.getItem(recoveryKey), raw);
});

test("제출 snapshot과 data signature가 같은 recovery mirror만 제거한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const otherSourceKey = createDocumentDraftKey("note", "student-1", "note-2");
  const submittedData = { title: "저장 완료", contentHtml: "<p>본문</p>" };
  const submittedSignature = createFormDraftDataSignature(submittedData);
  const canonicalRaw = serializeFormDraft(submittedData, 1_800_000_000_000);

  storage.setItem(sourceKey, canonicalRaw);
  const firstMirrorKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "writer-a",
    submittedData,
    1_800_000_001_000,
  );
  const secondMirrorKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "writer-b",
    { contentHtml: "<p>본문</p>", title: "저장 완료" },
    1_800_000_002_000,
  );
  const divergentKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "writer-c",
    { title: "다른 초안", contentHtml: "<p>보존</p>" },
    1_800_000_003_000,
  );
  const otherDocumentKey = writeImmutableRecovery(
    storage,
    otherSourceKey,
    "writer-a",
    submittedData,
    1_800_000_004_000,
  );

  const removed = removeFormDraftSnapshotsBySignature(
    storage,
    sourceKey,
    submittedSignature,
  );

  assert.deepEqual(new Set(removed), new Set([firstMirrorKey, secondMirrorKey]));
  assert.equal(storage.getItem(sourceKey), canonicalRaw);
  assert.equal(storage.getItem(firstMirrorKey), null);
  assert.equal(storage.getItem(secondMirrorKey), null);
  assert.notEqual(storage.getItem(divergentKey), null);
  assert.notEqual(storage.getItem(otherDocumentKey), null);
});

test("제출 정리는 marker 이후 생성된 같은 signature recovery를 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-cutoff");
  const submittedAt = 1_800_000_001_000;
  const submittedData = { title: "같은 내용", contentHtml: "<p>본문</p>" };
  const signature = createFormDraftDataSignature(submittedData);
  const beforeKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "before-submit",
    submittedData,
    submittedAt - 1,
  );
  const afterKey = writeImmutableRecovery(
    storage,
    sourceKey,
    "after-submit",
    submittedData,
    submittedAt + 1,
  );

  const removed = removeFormDraftSnapshotsBySignature(
    storage,
    sourceKey,
    signature,
    { savedAtOrBefore: submittedAt },
  );

  assert.deepEqual(removed, [beforeKey]);
  assert.equal(storage.getItem(beforeKey), null);
  assert.notEqual(storage.getItem(afterKey), null);
});

test("삭제 직전 다른 data로 바뀐 recovery는 제거하지 않는다", () => {
  const sourceKey = createDocumentDraftKey("community-post", "author-1", "post-1");
  const submittedData = { title: "저장 완료" };
  const submittedRaw = serializeFormDraft(submittedData, 1_800_000_001_000);
  const recoveryKey = createImmutableFormDraftRecoveryKey(
    sourceKey,
    "writer-a",
    submittedRaw,
  );
  const replacementRaw = serializeFormDraft({ title: "저장 뒤 이어 쓴 내용" }, 1_800_000_002_000);
  const storage = new RecoveryChangesBeforeRemovalStorage(recoveryKey, replacementRaw);
  storage.setItem(recoveryKey, submittedRaw);

  const removed = removeFormDraftSnapshotsBySignature(
    storage,
    sourceKey,
    createFormDraftDataSignature(submittedData),
  );

  assert.deepEqual(removed, []);
  assert.equal(storage.getItem(recoveryKey), replacementRaw);
});

test("구버전 mutable recovery는 rolling client 경합을 피해 tombstone으로만 숨기고 물리 삭제하지 않는다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-legacy-shadow");
  const legacyKey = createFormDraftRecoveryKey(sourceKey, "legacy-writer");
  const submittedData = { title: "구버전 shadow" };
  const raw = serializeFormDraft(submittedData, 1_800_000_000_000);
  storage.setItem(legacyKey, raw);

  assert.deepEqual(
    removeFormDraftSnapshotsBySignature(
      storage,
      sourceKey,
      createFormDraftDataSignature(submittedData),
    ),
    [],
  );
  assert.equal(storage.getItem(legacyKey), raw);
});

test("persist는 own shadow를 canonical보다 먼저 기록한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("qna-reply", "student-1", "thread-1");
  const recoveryKey = createFormDraftRecoveryKey(sourceKey, "writer-1");

  const result = persistFormDraftSnapshot(storage, {
    sourceKey,
    recoveryKey,
    data: { contentHtml: "<p>답변</p>" },
    expectedRaw: null,
    savedAt: 1_800_000_000_000,
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(storage.writes.slice(0, 2), [recoveryKey, sourceKey]);
  assert.equal(storage.getItem(recoveryKey), result.raw);
  assert.equal(storage.getItem(sourceKey), result.raw);
});

test("불변 recovery key는 다른 raw snapshot으로 덮어쓸 수 없다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-immutable");
  const firstRaw = serializeFormDraft({ title: "첫 shadow" }, 1_800_000_000_000);
  const secondRaw = serializeFormDraft({ title: "경합한 새 shadow" }, 1_800_000_001_000);
  const recoveryKey = createImmutableFormDraftRecoveryKey(
    sourceKey,
    "writer-a",
    firstRaw,
  );

  persistFormDraftRawSnapshot(storage, {
    sourceKey,
    recoveryKey,
    raw: firstRaw,
    expectedRaw: null,
  });
  assert.throws(
    () => persistFormDraftRawSnapshot(storage, {
      sourceKey,
      recoveryKey,
      raw: secondRaw,
      expectedRaw: firstRaw,
    }),
    /Immutable form draft recovery key/u,
  );
  assert.equal(storage.getItem(recoveryKey), firstRaw);
});

test("canonical compare 전에 충돌해도 own shadow를 남기고 canonical은 보존한다", () => {
  const storage = new MemoryDraftStorage();
  const sourceKey = createDocumentDraftKey("note", "student-1", "note-1");
  const recoveryKey = createFormDraftRecoveryKey(sourceKey, "writer-a");
  const expectedRaw = serializeFormDraft({ title: "기준" }, 1_800_000_000_000);
  const otherRaw = serializeFormDraft({ title: "다른 탭" }, 1_800_000_001_000);
  storage.setItem(sourceKey, otherRaw);

  const result = persistFormDraftSnapshot(storage, {
    sourceKey,
    recoveryKey,
    data: { title: "이 탭" },
    expectedRaw,
    savedAt: 1_800_000_002_000,
  });

  assert.equal(result.status, "conflict");
  assert.equal(storage.getItem(sourceKey), otherRaw);
  assert.equal(storage.getItem(recoveryKey), result.raw);
});

test("canonical compare/write 사이 TOCTOU로 덮여도 각 writer shadow는 남는다", () => {
  const sourceKey = createDocumentDraftKey("community-post", "author-1", "post-1");
  const writerAKey = createFormDraftRecoveryKey(sourceKey, "writer-a");
  const writerBKey = createFormDraftRecoveryKey(sourceKey, "writer-b");
  const baseRaw = serializeFormDraft({ title: "기준" }, 1_800_000_000_000);
  const writerBRaw = serializeFormDraft({ title: "B 탭" }, 1_800_000_002_000);
  const storage = new CanonicalOverwriteStorage(sourceKey, writerBRaw);
  storage.setItem(sourceKey, baseRaw);
  storage.setItem(writerBKey, writerBRaw);
  storage.enableCanonicalOverwrite();

  const result = persistFormDraftSnapshot(storage, {
    sourceKey,
    recoveryKey: writerAKey,
    data: { title: "A 탭" },
    expectedRaw: baseRaw,
    savedAt: 1_800_000_001_000,
  });

  assert.equal(result.status, "conflict");
  assert.equal(storage.getItem(sourceKey), writerBRaw);
  assert.equal(storage.getItem(writerAKey), result.raw);
  assert.equal(storage.getItem(writerBKey), writerBRaw);
});
