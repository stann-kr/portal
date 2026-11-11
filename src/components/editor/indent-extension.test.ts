import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { createFullEditorExtensions } from "./full-editor-extensions";
import { parseIndent } from "./indent-extension";

test("들여쓰기 단계는 1~6만 읽는다", () => {
  assert.equal(parseIndent("3"), 3);
  assert.equal(parseIndent("0"), 0);
  assert.equal(parseIndent("7"), 0);
  assert.equal(parseIndent("x"), 0);
  assert.equal(parseIndent(null), 0);
});

test("들여쓰기 없는 문단은 공동 편집 문서에 indent 속성을 남기지 않는다(기존 문서와 같은 블록으로 비교)", () => {
  const schema = getSchema(createFullEditorExtensions());
  const json = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "보통" }] },
      { type: "paragraph", attrs: { indent: 2 }, content: [{ type: "text", text: "들여씀" }] },
    ],
  };
  const doc = prosemirrorJSONToYDoc(schema, json, "default");
  const [plain, indented] = doc.getXmlFragment("default").toArray() as Y.XmlElement[];
  assert.equal(plain.getAttribute("indent"), undefined);
  assert.equal(indented.getAttribute("indent"), 2);
});
