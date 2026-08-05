import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const EDIT_FORM_SOURCES = [
  new URL("../components/notes/NoteEditorForm.tsx", import.meta.url),
  new URL("../components/community/PostEditForm.tsx", import.meta.url),
];

test("note/post 편집 폼은 full base snapshot 대신 fingerprint 하나만 전송한다", () => {
  for (const sourceUrl of EDIT_FORM_SOURCES) {
    const source = readFileSync(sourceUrl, "utf8");
    assert.match(source, /name=\{DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD\}/u);
    assert.doesNotMatch(source, /name=["']baseTitle["']/u);
    assert.doesNotMatch(source, /name=["']baseContentHtml["']/u);
    assert.doesNotMatch(source, /name=["']baseNoteDate["']/u);
  }
});
