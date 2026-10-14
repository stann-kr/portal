import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentSnapshotFingerprint,
  isDocumentSnapshotFingerprint,
  normalizeDocumentSnapshotNoteDate,
  parseDocumentNoteDateInput,
} from "./document-snapshot-fingerprint";

test("문서 snapshot fingerprint는 domain·kind·resource·원문·날짜의 고정 tuple을 해시한다", () => {
  const noteFingerprint = createDocumentSnapshotFingerprint({
    kind: "private-note",
    id: "note-1",
    title: "  제목  ",
    contentHtml: "<p>e\u0301</p>",
    noteDate: "2026-02-28",
  });
  const postFingerprint = createDocumentSnapshotFingerprint({
    kind: "community-post",
    id: "post-1",
    title: "제목",
    contentHtml: "<p>본문</p>",
    noteDate: null,
  });

  assert.equal(
    noteFingerprint,
    "sha256:c8363e8dcd6f95c9b091989f374b5b2ed6bef737d77a3ebda7500f667c827281",
  );
  assert.equal(
    postFingerprint,
    "sha256:f383253a553acc6ae6dd1b5109221738977b59d34ae1d6f22329e4af1c4c40a1",
  );
  assert.equal(isDocumentSnapshotFingerprint(noteFingerprint), true);
  assert.equal(isDocumentSnapshotFingerprint(postFingerprint), true);
});

test("fingerprint는 리소스와 저장 원문의 사소한 차이도 보존한다", () => {
  const base = {
    kind: "private-note" as const,
    id: "note-1",
    title: "제목",
    contentHtml: "<p>é</p>",
    noteDate: "2026-08-05",
  };
  const fingerprint = createDocumentSnapshotFingerprint(base);

  assert.notEqual(
    createDocumentSnapshotFingerprint({ ...base, id: "note-2" }),
    fingerprint,
  );
  assert.notEqual(
    createDocumentSnapshotFingerprint({ ...base, title: " 제목" }),
    fingerprint,
  );
  assert.notEqual(
    createDocumentSnapshotFingerprint({ ...base, contentHtml: "<p>e\u0301</p>" }),
    fingerprint,
  );
  assert.notEqual(
    createDocumentSnapshotFingerprint({ ...base, noteDate: "2026-08-06" }),
    fingerprint,
  );
});

test("fingerprint 외부 입력은 canonical lowercase SHA-256만 허용한다", () => {
  assert.equal(isDocumentSnapshotFingerprint(`sha256:${"0".repeat(64)}`), true);
  assert.equal(isDocumentSnapshotFingerprint(`sha256:${"A".repeat(64)}`), false);
  assert.equal(isDocumentSnapshotFingerprint("0".repeat(64)), false);
  assert.equal(isDocumentSnapshotFingerprint(`sha256:${"0".repeat(63)}`), false);
  assert.equal(isDocumentSnapshotFingerprint(null), false);
});

test("노트 날짜는 null·empty·Date를 canonical date-only로 정규화한다", () => {
  assert.equal(normalizeDocumentSnapshotNoteDate(null), null);
  assert.equal(normalizeDocumentSnapshotNoteDate(""), null);
  assert.equal(
    normalizeDocumentSnapshotNoteDate(new Date("2026-08-05T23:59:59.999Z")),
    "2026-08-05",
  );
  assert.equal(
    parseDocumentNoteDateInput("2024-02-29")?.toISOString(),
    "2024-02-29T00:00:00.000Z",
  );
  assert.equal(parseDocumentNoteDateInput(""), null);
  assert.equal(parseDocumentNoteDateInput(null), null);
});

test("노트 날짜는 비canonical·존재하지 않는 일자를 조용히 보정하지 않는다", () => {
  for (const value of [
    "2023-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-8-05",
    " 2026-08-05",
    "2026-08-05T00:00:00.000Z",
  ]) {
    assert.throws(
      () => parseDocumentNoteDateInput(value),
      /Invalid document snapshot note date/u,
    );
  }
  assert.throws(
    () => normalizeDocumentSnapshotNoteDate(new Date(Number.NaN)),
    /Invalid document snapshot note date/u,
  );
});
