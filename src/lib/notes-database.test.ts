import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NOTES_SORT,
  formatNotesSortValue,
  getNotesSortAria,
  parseNotesSort,
  resolveNotesViewMode,
  sortNotesDatabaseRows,
  toNotesDatabaseRow,
  toNotesDatabaseRows,
  toggleNotesSort,
  type NotesDatabaseRow,
} from "./notes-database";
import {
  createAccountCalendarTabStorageKey,
  createAccountNotesViewStorageKey,
  readAccountCalendarTabStorageOwnerId,
  readAccountNotesViewStorageOwnerId,
} from "./local-owner-keys";

const source = {
  id: "n1",
  title: "비트 매칭",
  contentHtml: "<p>템포 &amp; <strong>EQ</strong></p><script>alert(1)</script>",
  noteDate: null,
  createdAt: new Date("2026-10-19T16:00:00Z"),
  updatedAt: new Date("2026-10-20T06:05:00Z"),
  authorName: "강사",
};

function row(id: string, patch: Partial<NotesDatabaseRow> = {}): NotesDatabaseRow {
  return {
    id, title: id, preview: "", authorName: null,
    dateValue: null, updatedValue: null, dateLabel: "", updatedLabel: "",
    ...patch,
  };
}

test("database 행은 본문 HTML 대신 평문 미리보기와 KST 날짜(noteDate 우선, 없으면 작성일) 문자열만 담는다", () => {
  const converted = toNotesDatabaseRow(source);
  assert.equal(converted.preview, "템포 & EQ");
  assert.equal("contentHtml" in converted, false);
  // UTC 16시는 KST 다음 날 1시다.
  assert.equal(converted.dateLabel, "2026년 10월 20일");
  assert.equal(converted.dateValue, source.createdAt.getTime());
  assert.match(converted.updatedLabel, /2026년 10월 20일 오후 3:05/u);
  const withNoteDate = toNotesDatabaseRow({ ...source, noteDate: new Date("2025-03-02T00:00:00Z"), searchPreview: "검색 일치 부분" });
  assert.equal(withNoteDate.dateLabel, "2025년 3월 2일");
  assert.equal(withNoteDate.preview, "검색 일치 부분");
  const empty = toNotesDatabaseRows([{ ...source, createdAt: null, updatedAt: null, contentHtml: "" }])[0];
  assert.equal(empty.dateLabel, "날짜 없음");
  assert.equal(empty.dateValue, null);
  assert.equal(empty.preview, "본문 미리보기 없음");
});

test("정렬 기본값은 날짜 최신순이고 같은 열은 방향을 뒤집으며 다른 열은 그 열의 기본 방향으로 시작한다", () => {
  assert.deepEqual(DEFAULT_NOTES_SORT, { key: "date", direction: "desc" });
  assert.deepEqual(toggleNotesSort(DEFAULT_NOTES_SORT, "date"), { key: "date", direction: "asc" });
  assert.deepEqual(toggleNotesSort(DEFAULT_NOTES_SORT, "updated"), { key: "updated", direction: "desc" });
  assert.deepEqual(toggleNotesSort(DEFAULT_NOTES_SORT, "title"), { key: "title", direction: "asc" });
  assert.equal(getNotesSortAria(DEFAULT_NOTES_SORT, "date"), "descending");
  assert.equal(getNotesSortAria({ key: "title", direction: "asc" }, "title"), "ascending");
  assert.equal(getNotesSortAria(DEFAULT_NOTES_SORT, "title"), "none");
  assert.deepEqual(parseNotesSort(formatNotesSortValue({ key: "author", direction: "desc" })), { key: "author", direction: "desc" });
  assert.equal(parseNotesSort("constructor:asc"), null);
  assert.equal(parseNotesSort("date:sideways"), null);
});

test("날짜·수정일 정렬은 값 없는 행을 항상 끝에 두고 원본을 바꾸지 않으며 동률은 수정일·id로 고정한다", () => {
  const rows = [
    row("none"),
    row("old", { dateValue: 1, updatedValue: 5 }),
    row("new", { dateValue: 3, updatedValue: 1 }),
    row("tie-b", { dateValue: 2, updatedValue: 2 }),
    row("tie-a", { dateValue: 2, updatedValue: 2 }),
    row("tie-fresh", { dateValue: 2, updatedValue: 9 }),
  ];
  const snapshot = rows.map((item) => item.id);
  assert.deepEqual(sortNotesDatabaseRows(rows, { key: "date", direction: "desc" }).map((item) => item.id), ["new", "tie-fresh", "tie-a", "tie-b", "old", "none"]);
  assert.deepEqual(sortNotesDatabaseRows(rows, { key: "date", direction: "asc" }).map((item) => item.id), ["old", "tie-fresh", "tie-a", "tie-b", "new", "none"]);
  assert.deepEqual(sortNotesDatabaseRows(rows, { key: "updated", direction: "desc" }).map((item) => item.id).slice(0, 2), ["tie-fresh", "old"]);
  assert.deepEqual(rows.map((item) => item.id), snapshot);
});

test("제목·작성자 정렬은 한국어 가나다(한글 먼저)·숫자 자연순이고 빈 작성자는 끝에 둔다", () => {
  const rows = [row("a", { title: "레슨 10" }), row("b", { title: "레슨 2" }), row("c", { title: "가요 믹스" }), row("d", { title: "EQ" })];
  assert.deepEqual(sortNotesDatabaseRows(rows, { key: "title", direction: "asc" }).map((item) => item.title), ["가요 믹스", "레슨 2", "레슨 10", "EQ"]);
  assert.deepEqual(sortNotesDatabaseRows(rows, { key: "title", direction: "desc" }).map((item) => item.title), ["EQ", "레슨 10", "레슨 2", "가요 믹스"]);
  const authors = [row("x", { authorName: null }), row("y", { authorName: "학생" }), row("z", { authorName: "강사" })];
  for (const direction of ["asc", "desc"] as const) {
    assert.equal(sortNotesDatabaseRows(authors, { key: "author", direction }).at(-1)?.id, "x");
  }
});

test("보기 선택은 표·목록만 받아들이고 계정별 키는 다른 계정·캘린더 키와 섞이지 않는다", () => {
  assert.equal(resolveNotesViewMode("table"), "table");
  assert.equal(resolveNotesViewMode("list"), "list");
  assert.equal(resolveNotesViewMode("board"), null);
  assert.equal(resolveNotesViewMode(null), null);
  const key = createAccountNotesViewStorageKey("user/a b");
  assert.equal(key, "portal:notesView:user%2Fa%20b");
  assert.notEqual(key, createAccountNotesViewStorageKey("user-b"));
  assert.equal(readAccountNotesViewStorageOwnerId(key), "user/a b");
  assert.equal(readAccountNotesViewStorageOwnerId("portal:notesView:%E0"), null);
  assert.equal(readAccountNotesViewStorageOwnerId("portal:notesView:"), null);
  assert.equal(readAccountNotesViewStorageOwnerId(createAccountCalendarTabStorageKey("user-a")), null);
  assert.equal(readAccountCalendarTabStorageOwnerId(key), null);
  assert.throws(() => createAccountNotesViewStorageKey(""), TypeError);
});
