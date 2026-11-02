import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirror } from "@tiptap/y-tiptap";
import { createFullEditorExtensions } from "@/components/editor/full-editor-extensions";
import {
  buildCollabRestoreUpdate,
  canonicalServerHtml,
  collabHtmlToPmNode,
  collabPmNodeToHtml,
  COLLAB_META_LIFECYCLE,
  readCollabStateContent,
} from "./server-restore";

const schema = getSchema(createFullEditorExtensions());

function roomFromHtml(html: string, fields: Record<string, string> = {}): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, collabHtmlToPmNode(html).toJSON(), doc.getXmlFragment("default"));
    const meta = doc.getMap("meta");
    meta.set("seeded", true);
    for (const [name, value] of Object.entries(fields)) meta.set(name, value);
  });
  return doc;
}

function html(doc: Y.Doc): string {
  return collabPmNodeToHtml(yXmlFragmentToProsemirror(schema, doc.getXmlFragment("default")));
}

test("서버 HTML 변환: 표·체크리스트·정렬·강조·이미지가 편집기 schema로 왕복한다", () => {
  const source =
    '<h2>제목</h2><p data-text-align="center">가운데 <mark>강조</mark> <strong>굵게</strong> <a href="https://a.test">링크</a></p>' +
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>할 일</p></li></ul>' +
    '<table><tbody><tr><th><p>머리</p></th></tr><tr><td><p>칸</p></td></tr></tbody></table><img src="https://x.test/a.png" alt="그림">';
  const once = canonicalServerHtml(source);
  assert.equal(canonicalServerHtml(once), once, "한 번 정규화한 HTML은 다시 바뀌지 않는다");
  for (const fragment of ['data-text-align="center"', "<mark>", 'data-type="taskItem"', 'data-checked="true"', "<th", 'src="https://x.test/a.png"', 'href="https://a.test"']) {
    assert.ok(once.includes(fragment), `${fragment} 보존: ${once}`);
  }
});

test("복원 update: 같은 live 문서에 적용되어 바뀌지 않은 블록은 재사용하고, 준비 뒤 동시 입력은 남기며, 칸·lifecycle을 함께 쓴다", () => {
  const room = roomFromHtml("<p>첫 줄</p><p>abc</p><p>그대로</p>", { title: "지금 제목" });
  const base = Y.encodeStateAsUpdate(room);
  const keptBlock = room.getXmlFragment("default").get(2);
  // 준비(S) 뒤 다른 기기가 바꿀 블록 안에 입력했다(복원이 그 블록을 바꾼다).
  const other = new Y.Doc();
  Y.applyUpdate(other, base);
  const text = (other.getXmlFragment("default").get(1) as Y.XmlElement).get(0) as Y.XmlText;
  text.insert(2, "LOCAL");
  Y.applyUpdate(room, Y.encodeStateAsUpdate(other, Y.encodeStateVector(room)));

  const update = buildCollabRestoreUpdate({
    base,
    current: Y.encodeStateAsUpdate(room),
    html: "<h2>abc</h2><p>그대로</p>",
    fields: { title: "옛 제목" },
    lifecycle: 9,
  });
  Y.applyUpdate(room, update);
  const result = html(room);
  assert.ok(result.startsWith("<h2>abc</h2>"), result);
  assert.ok(result.includes("abLOCALc"), `동시 입력이 문서에 남는다: ${result}`);
  assert.ok(!result.includes("첫 줄"), "복원본에 없는 블록은 지운다");
  assert.equal(room.getXmlFragment("default").toArray().includes(keptBlock), true, "바뀌지 않은 블록은 같은 Yjs 노드(다른 기기 커서 유지)");
  assert.equal(room.getMap("meta").get("title"), "옛 제목");
  assert.equal(room.getMap("meta").get(COLLAB_META_LIFECYCLE), 9);
});

test("복원 update: 칸을 준비 뒤 다른 기기가 바꿨으면 그 입력을 남긴다", () => {
  const room = roomFromHtml("<p>본문</p>", { title: "A" });
  const base = Y.encodeStateAsUpdate(room);
  room.getMap("meta").set("title", "동시 입력");
  const update = buildCollabRestoreUpdate({ base, current: Y.encodeStateAsUpdate(room), html: "<p>옛 본문</p>", fields: { title: "옛" }, lifecycle: 3 });
  Y.applyUpdate(room, update);
  assert.equal(room.getMap("meta").get("title"), "동시 입력");
  assert.equal(readCollabStateContent(Y.encodeStateAsUpdate(room)).html, "<p>옛 본문</p>");
});

test("복원 update: 매번 새 clientID로 만들어 기존 작성자 id와 겹치지 않는다", () => {
  const room = roomFromHtml("<p>x</p>");
  const known = new Set(room.store.clients.keys());
  const update = buildCollabRestoreUpdate({ base: null, current: Y.encodeStateAsUpdate(room), html: "<p>y</p>", fields: {}, lifecycle: 1 });
  const decoded = Y.decodeUpdate(update);
  const authors = new Set(decoded.structs.map((struct) => struct.id.client));
  assert.equal(authors.size, 1);
  for (const author of authors) assert.equal(known.has(author), false);
});
