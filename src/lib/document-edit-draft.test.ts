import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentEditDraftMetadata,
  DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE,
  resolveDocumentEditDraftBase,
} from "./document-edit-draft";
import { createDocumentSnapshotFingerprint } from "./document-snapshot-fingerprint";
import { serializeFormDraft } from "./form-draft";

const currentNoteSnapshot = {
  kind: "private-note" as const,
  id: "note-1",
  title: "현재 제목",
  noteDate: "2026-08-05",
  contentHtml: "<p>현재 본문</p>",
};

test("compact fingerprint를 legacy base보다 우선해 stale 여부를 판정한다", () => {
  const staleFingerprint = createDocumentSnapshotFingerprint({
    ...currentNoteSnapshot,
    contentHtml: "<p>이전 본문</p>",
  });
  const resolved = resolveDocumentEditDraftBase(
    {
      baseFingerprint: staleFingerprint,
      base: {
        title: currentNoteSnapshot.title,
        noteDate: currentNoteSnapshot.noteDate,
        contentHtml: currentNoteSnapshot.contentHtml,
      },
    },
    currentNoteSnapshot,
    false,
  );

  assert.equal(resolved.hasStaleDraftBase, true);
  assert.equal(resolved.draftBaseFingerprint, staleFingerprint);
});

test("legacy full base는 resource domain을 보존한 fingerprint로 복원한다", () => {
  const legacyBase = {
    title: "이전 제목",
    noteDate: "2026-08-04",
    contentHtml: "<p>이전 본문</p>",
  };
  const expectedFingerprint = createDocumentSnapshotFingerprint({
    kind: "private-note",
    id: currentNoteSnapshot.id,
    ...legacyBase,
  });
  const resolved = resolveDocumentEditDraftBase(
    { base: legacyBase },
    currentNoteSnapshot,
    false,
  );

  assert.equal(resolved.hasStaleDraftBase, true);
  assert.equal(resolved.draftBaseFingerprint, expectedFingerprint);
  assert.notEqual(
    resolved.draftBaseFingerprint,
    createDocumentSnapshotFingerprint({
      kind: "private-note",
      id: "note-2",
      ...legacyBase,
    }),
  );
});

test("비canonical legacy noteDate는 복원을 중단하지 않고 resource sentinel로 stale 잠근다", () => {
  const resolved = resolveDocumentEditDraftBase(
    {
      base: {
        title: "과거 제목",
        noteDate: "2026-02-30",
        contentHtml: "<p>과거 본문</p>",
      },
    },
    currentNoteSnapshot,
    false,
  );
  const sentinelFingerprint = createDocumentSnapshotFingerprint({
    kind: "private-note",
    id: currentNoteSnapshot.id,
    title: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.title,
    noteDate: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.noteDate,
    contentHtml: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.contentHtml,
  });

  assert.equal(resolved.hasStaleDraftBase, true);
  assert.equal(resolved.draftBaseFingerprint, sentinelFingerprint);
  assert.doesNotThrow(() =>
    createDocumentEditDraftMetadata(resolved.draftBaseFingerprint),
  );
});

test("현재 서버와 같은 draft 내용은 이전 base와 달라도 충돌을 해제한다", () => {
  const resolved = resolveDocumentEditDraftBase(
    {
      baseFingerprint: createDocumentSnapshotFingerprint({
        ...currentNoteSnapshot,
        contentHtml: "<p>이전 본문</p>",
      }),
    },
    currentNoteSnapshot,
    true,
  );

  assert.equal(resolved.hasStaleDraftBase, false);
  assert.equal(
    resolved.draftBaseFingerprint,
    createDocumentSnapshotFingerprint(currentNoteSnapshot),
  );
});

test("legacy full base가 현재 서버와 같으면 compact 기준으로 채택한다", () => {
  const resolved = resolveDocumentEditDraftBase(
    {
      base: {
        title: currentNoteSnapshot.title,
        noteDate: currentNoteSnapshot.noteDate,
        contentHtml: currentNoteSnapshot.contentHtml,
      },
    },
    currentNoteSnapshot,
    false,
  );

  assert.equal(resolved.hasStaleDraftBase, false);
  assert.equal(resolved.draftBaseFingerprint, resolved.currentFingerprint);
});

test("기준 metadata가 없는 변경 초안은 현재 서버 기준으로 간주하지 않고 stale 잠근다", () => {
  const resolved = resolveDocumentEditDraftBase(
    {
      baseFingerprint: "malformed",
      base: { title: "불완전한 기준" },
    },
    currentNoteSnapshot,
    false,
  );
  const sentinelFingerprint = createDocumentSnapshotFingerprint({
    kind: "private-note",
    id: currentNoteSnapshot.id,
    title: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.title,
    noteDate: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.noteDate,
    contentHtml: DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.contentHtml,
  });

  assert.equal(resolved.hasStaleDraftBase, true);
  assert.equal(resolved.draftBaseFingerprint, sentinelFingerprint);
  assert.notEqual(resolved.draftBaseFingerprint, resolved.currentFingerprint);
});

test("기준 metadata가 없어도 초안 자체가 현재 서버와 같으면 stale 잠금을 만들지 않는다", () => {
  const resolved = resolveDocumentEditDraftBase(
    {},
    currentNoteSnapshot,
    true,
  );

  assert.equal(resolved.hasStaleDraftBase, false);
  assert.equal(resolved.draftBaseFingerprint, resolved.currentFingerprint);
});

test("고정 legacy sentinel은 구버전 note/post 판정에서 유효 서버 문서를 stale로 잠근다", () => {
  const noteMatchesLegacyBase =
    DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.title === currentNoteSnapshot.title &&
    DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.noteDate === currentNoteSnapshot.noteDate &&
    DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.contentHtml ===
      currentNoteSnapshot.contentHtml;
  const currentPostSnapshot = {
    title: "현재 게시물",
    contentHtml: "<p>게시물 본문</p>",
  };
  const postMatchesLegacyBase =
    DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.title === currentPostSnapshot.title &&
    DOCUMENT_EDIT_DRAFT_LEGACY_STALE_BASE.contentHtml ===
      currentPostSnapshot.contentHtml;

  assert.equal(noteMatchesLegacyBase, false);
  assert.equal(postMatchesLegacyBase, false);
});

test("512KiB compact draft는 본문을 한 번만 저장하고 크기는 본문+고정 overhead다", () => {
  const body = "x".repeat(512 * 1024);
  const baseFingerprint = createDocumentSnapshotFingerprint({
    kind: "community-post",
    id: "post-1",
    title: "저장 기준",
    contentHtml: "<p>서버 본문</p>",
    noteDate: null,
  });
  const metadata = createDocumentEditDraftMetadata(baseFingerprint);
  const emptyRaw = serializeFormDraft(
    { title: "대형 문서", contentHtml: "", ...metadata },
    1_800_000_000_000,
  );
  const largeRaw = serializeFormDraft(
    { title: "대형 문서", contentHtml: body, ...metadata },
    1_800_000_000_000,
  );

  assert.equal(largeRaw.length - emptyRaw.length, body.length);
  assert.equal(largeRaw.indexOf(body), largeRaw.lastIndexOf(body));
  assert.ok(largeRaw.length <= body.length + 256);
});

test("compact metadata는 canonical fingerprint만 허용한다", () => {
  assert.throws(
    () => createDocumentEditDraftMetadata("sha256:invalid"),
    /Invalid document edit draft base fingerprint/u,
  );
});
