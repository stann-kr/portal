import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { moveCursorAfterInsertedNode } from "./cursor-after-inserted-node";
import { createFullEditorExtensions } from "./full-editor-extensions";

const schema = getSchema(createFullEditorExtensions());
const text = (value: string) => ({ type: "paragraph", content: [{ type: "text", text: value }] });
const image = (src: string) => ({ type: "image", attrs: { src } });
const table = (cell: string) => ({
  type: "table",
  content: [{ type: "tableRow", content: [{ type: "tableCell", content: [text(cell)] }] }],
});

/** `content`로 문서를 만들고 `src` 이미지를 방금 넣은 것처럼 선택한 뒤 커서를 옮긴 결과. */
function afterInserting(content: unknown[], src: string) {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  let imagePos = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.src === src) imagePos = pos;
  });
  assert.notEqual(imagePos, -1);
  const state = EditorState.create({ schema, doc, selection: NodeSelection.create(doc, imagePos) });
  const tr = state.tr;
  assert.equal(moveCursorAfterInsertedNode(tr), true);
  const next = state.apply(tr);
  return {
    json: next.doc.toJSON().content as Array<{ type: string }>,
    selection: next.selection,
    /** 커서가 넣은 이미지 바로 뒤 블록의 맨 앞에 있는가. */
    cursorRightAfterImage: next.selection instanceof TextSelection
      && next.selection.empty
      && next.selection.from === imagePos + 2,
  };
}

test("넣은 이미지 바로 뒤가 글 블록이면 새 문단 없이 그 맨 앞에 커서를 둔다", () => {
  const result = afterInserting([text("앞"), image("a"), text("뒤")], "a");

  assert.deepEqual(result.json.map((node) => node.type), ["paragraph", "image", "paragraph"]);
  assert.equal(result.cursorRightAfterImage, true);
  assert.equal(result.selection.$from.parent.textContent, "뒤");
});

test("넣은 이미지가 문서의 마지막이면 뒤에 빈 문단을 만들어 커서를 둔다", () => {
  const result = afterInserting([text("앞"), image("a")], "a");

  assert.deepEqual(result.json.map((node) => node.type), ["paragraph", "image", "paragraph"]);
  assert.equal(result.cursorRightAfterImage, true);
  assert.equal(result.selection.$from.parent.textContent, "");
});

test("넣은 이미지 바로 뒤가 표면 표의 첫 칸으로 건너뛰지 않고 그 사이에 빈 문단을 만든다", () => {
  const result = afterInserting([image("a"), table("칸"), text("끝")], "a");

  assert.deepEqual(result.json.map((node) => node.type), ["image", "paragraph", "table", "paragraph"]);
  assert.equal(result.cursorRightAfterImage, true);
  assert.equal(result.selection.$from.parent.textContent, "");
  assert.equal(result.selection.$from.depth, 1);
});

test("넣은 이미지 뒤에 다른 이미지가 이어지면 먼 문단으로 건너뛰지 않고 바로 뒤에 빈 문단을 만든다", () => {
  const result = afterInserting([image("a"), image("b"), image("c"), text("끝")], "a");

  assert.deepEqual(result.json.map((node) => node.type), ["image", "paragraph", "image", "image", "paragraph"]);
  assert.equal(result.cursorRightAfterImage, true);
  assert.equal(result.selection.$from.parent.textContent, "");
});

test("인용 안의 마지막에 넣은 이미지는 인용 밖 문단으로 나가지 않고 인용 안에 빈 문단을 만든다", () => {
  const result = afterInserting([{ type: "blockquote", content: [text("인용"), image("a")] }, text("밖")], "a");

  assert.deepEqual(result.json.map((node) => node.type), ["blockquote", "paragraph"]);
  assert.equal(result.cursorRightAfterImage, true);
  assert.equal(result.selection.$from.node(1).type.name, "blockquote");
  assert.equal(result.selection.$from.parent.textContent, "");
});

test("블록이 선택되어 있지 않으면 선택과 문서를 그대로 둔다", () => {
  const doc = schema.nodeFromJSON({ type: "doc", content: [text("글"), image("a")] });
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2) });
  const tr = state.tr;

  assert.equal(moveCursorAfterInsertedNode(tr), true);
  assert.equal(tr.docChanged, false);
  assert.equal(tr.selectionSet, false);
});
