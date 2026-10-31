import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const EDIT_FORM_SOURCES = [
  new URL("../components/notes/NoteEditorForm.tsx", import.meta.url),
  new URL("../components/community/PostEditForm.tsx", import.meta.url),
];

test("note/post 편집 요청은 full base snapshot(제목·본문·날짜)을 보내지 않는다", () => {
  for (const sourceUrl of EDIT_FORM_SOURCES) {
    const source = readFileSync(sourceUrl, "utf8");
    assert.doesNotMatch(source, /name=["']baseTitle["']/u);
    assert.doesNotMatch(source, /name=["']baseContentHtml["']/u);
    assert.doesNotMatch(source, /name=["']baseNoteDate["']/u);
  }
});
