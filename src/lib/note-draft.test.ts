import assert from "node:assert/strict";
import test from "node:test";
import {
  isCreateNoteDraftEmpty,
  resolveRestoredCreateNoteDate,
} from "./note-draft";

const defaultNoteDate = "2026-08-05";

test("기본 날짜만 채워진 새 노트는 빈 초안으로 판정한다", () => {
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "", noteDate: defaultNoteDate, contentHtml: "<p></p>" },
      defaultNoteDate,
    ),
    true,
  );
});

test("사용자가 날짜만 바꾸거나 비워도 복원할 초안으로 판정한다", () => {
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "", noteDate: "2026-08-12", contentHtml: "<p></p>" },
      defaultNoteDate,
    ),
    false,
  );
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "", noteDate: "", contentHtml: "<p></p>" },
      defaultNoteDate,
    ),
    false,
  );
});

test("제목이나 본문이 있으면 날짜와 무관하게 복원할 초안으로 판정한다", () => {
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "연습 기록", noteDate: defaultNoteDate, contentHtml: "<p></p>" },
      defaultNoteDate,
    ),
    false,
  );
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "", noteDate: defaultNoteDate, contentHtml: "<p>본문</p>" },
      defaultNoteDate,
    ),
    false,
  );
});

test("빠른 입력 기본 제목만 있는 새 노트는 빈 초안으로, 본문이나 다른 제목이 있으면 초안으로 판정한다", () => {
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "믹스 연습", noteDate: defaultNoteDate, contentHtml: "<p></p>" },
      defaultNoteDate,
      "믹스 연습",
    ),
    true,
  );
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "믹스 연습 계획", noteDate: defaultNoteDate, contentHtml: "<p></p>" },
      defaultNoteDate,
      "믹스 연습",
    ),
    false,
  );
  assert.equal(
    isCreateNoteDraftEmpty(
      { title: "믹스 연습", noteDate: defaultNoteDate, contentHtml: "<p>본문</p>" },
      defaultNoteDate,
      "믹스 연습",
    ),
    false,
  );
});

test("저장된 빈 날짜도 그대로 복원하고 legacy 누락값만 기본 날짜로 채운다", () => {
  assert.equal(resolveRestoredCreateNoteDate("", defaultNoteDate), "");
  assert.equal(
    resolveRestoredCreateNoteDate("2026-08-12", defaultNoteDate),
    "2026-08-12",
  );
  assert.equal(
    resolveRestoredCreateNoteDate(undefined, defaultNoteDate),
    defaultNoteDate,
  );
  assert.equal(
    resolveRestoredCreateNoteDate(null, defaultNoteDate),
    defaultNoteDate,
  );
});
