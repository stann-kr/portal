import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { GuideBlockId } from "./guide-block-id-extension";

test("가이드 블록 식별자를 보존하고 문단 끝 Enter의 새 문단에는 복사하지 않는다", (context) => {
  const browserWindow = new Window({ url: "https://portal.test/guide" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: browserWindow, document: browserWindow.document });

  const element = browserWindow.document.createElement("div");
  const editor = new Editor({
    element: element as unknown as HTMLElement,
    extensions: [StarterKit, GuideBlockId],
    content: '<h2 data-block-id="h1">제목</h2><p data-block-id="keep">앞뒤</p><ul><li data-block-id="li1"><p data-block-id="lp1">항목</p></li></ul><p data-block-id="bad id">x</p>',
  });
  context.after(() => editor.destroy());

  assert.match(editor.getHTML(), /<h2 data-block-id="h1">/u);
  assert.match(editor.getHTML(), /<li data-block-id="li1"><p data-block-id="lp1">/u);
  assert.doesNotMatch(editor.getHTML(), /bad id|data-block-id="null"/u);

  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.blockId === "keep") position = pos + 2;
    return true;
  });
  // 문단 끝에서 Enter: keepOnSplit=false라 새 문단에 식별자를 복사하지 않는다.
  editor.chain().setTextSelection(position + 1).splitBlock().run();
  assert.match(editor.getHTML(), /<p data-block-id="keep">앞뒤<\/p><p><\/p>/u);
  // 문단 가운데에서 나누면 ProseMirror가 속성을 그대로 복사한다. 이 중복은 저장 때 ensureGuideBlockIds가 뒤쪽에 새 식별자를 준다.
  editor.chain().setTextSelection(position).splitBlock().run();
  assert.match(editor.getHTML(), /<p data-block-id="keep">앞<\/p><p data-block-id="keep">뒤<\/p>/u);

  const plain = new Editor({ element: browserWindow.document.createElement("div") as unknown as HTMLElement, extensions: [StarterKit], content: '<p data-block-id="keep">노트</p>' });
  context.after(() => plain.destroy());
  // 편집기 정리가 window를 쓰므로 전역 복원은 마지막에 등록한다.
  context.after(() => Object.assign(globalThis, previous));
  assert.equal(plain.getHTML(), "<p>노트</p>", "가이드가 아닌 편집기는 식별자를 만들거나 지키지 않는다");
});
