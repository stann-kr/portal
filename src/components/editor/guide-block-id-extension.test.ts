import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";
import { GuideBlockId } from "./guide-block-id-extension";
import { createFullEditorExtensions } from "./full-editor-extensions";
import { seedCollabDoc } from "@/lib/collab/client/seed";
import { collabDocHtml } from "@/lib/collab/client/doc-html";
import { listGuideBlockIds, prepareGuideHtml } from "@/lib/guide-content";

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
  // 문단 끝에서 Enter: 식별자를 복사하지 않고(keepOnSplit=false) 편집기가 새 식별자를 바로 준다.
  editor.chain().setTextSelection(position + 1).splitBlock().run();
  const afterEnd = /<p data-block-id="keep">앞뒤<\/p><p data-block-id="(b[a-z0-9]{10})"><\/p>/u.exec(editor.getHTML());
  assert.ok(afterEnd, editor.getHTML());
  // 문단 가운데에서 나누면 ProseMirror가 속성을 복사한다. 앞 조각이 식별자를 지키고 뒤 조각은 새 식별자를 받는다(서버 규칙과 같다).
  editor.chain().setTextSelection(position).splitBlock().run();
  const afterMiddle = /<p data-block-id="keep">앞<\/p><p data-block-id="(b[a-z0-9]{10})">뒤<\/p><p data-block-id="(b[a-z0-9]{10})"><\/p>/u.exec(editor.getHTML());
  assert.ok(afterMiddle, editor.getHTML());
  assert.notEqual(afterMiddle[1], afterMiddle[2]);
  assert.equal(afterMiddle[2], afterEnd[1], "이미 받은 식별자는 다음 편집에서 바뀌지 않는다");
  // 시드 때 식별자가 맞지 않던 블록도 첫 편집에서 식별자를 받는다.
  assert.doesNotMatch(editor.getHTML(), /<p>x<\/p>/u);

  const plain = new Editor({ element: browserWindow.document.createElement("div") as unknown as HTMLElement, extensions: [StarterKit], content: '<p data-block-id="keep">노트</p>' });
  context.after(() => plain.destroy());
  // 편집기 정리가 window를 쓰므로 전역 복원은 마지막에 등록한다.
  context.after(() => Object.assign(globalThis, previous));
  assert.equal(plain.getHTML(), "<p>노트</p>", "가이드가 아닌 편집기는 식별자를 만들거나 지키지 않는다");
});

test("공동 편집 doc에서 새로 만든 블록의 식별자는 저장을 거듭해도 같고 다른 기기에도 그대로 보인다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/guide" });
  const globals = globalThis as Record<string, unknown>;
  const names = ["window", "document", "Node", "HTMLElement", "Element", "DOMParser", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"];
  const previous = new Map(names.map((name) => [name, globals[name]]));
  for (const name of names) {
    globals[name] = name === "window" ? browserWindow : (browserWindow as unknown as Record<string, unknown>)[name];
  }
  const saveExtensions = createFullEditorExtensions({ preserveBlockIds: true });
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  docA.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== "remote") Y.applyUpdate(docB, update, "remote"); });
  docB.on("update", (update: Uint8Array, origin: unknown) => { if (origin !== "remote") Y.applyUpdate(docA, update, "remote"); });
  seedCollabDoc(docA, { key: "guide:g1", version: 1, html: prepareGuideHtml("<h2>장비</h2><p>첫 문단</p>") }, saveExtensions);

  const mount = (doc: Y.Doc) => {
    const element = browserWindow.document.createElement("div");
    browserWindow.document.body.appendChild(element);
    const editor = new Editor({
      element: element as unknown as HTMLElement,
      extensions: createFullEditorExtensions({ preserveBlockIds: true, collaboration: { doc, user: { name: "", colorIndex: 0 } } as never }),
    });
    context.after(() => editor.destroy());
    return editor;
  };
  const editorA = mount(docA);
  const editorB = mount(docB);
  context.after(() => { for (const [name, value] of previous) globals[name] = value; });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const save = (doc: Y.Doc) => listGuideBlockIds(prepareGuideHtml(collabDocHtml(doc, saveExtensions)));
  const seeded = save(docA);
  let endOfLast = -1;
  editorA.state.doc.forEach((node, offset) => { endOfLast = offset + node.nodeSize - 1; });
  editorA.chain().setTextSelection(endOfLast).splitBlock().insertContent("새 문단").run();

  const first = save(docA);
  assert.equal(first.length, 3);
  assert.deepEqual(first.slice(0, 2), seeded, "시드한 블록의 식별자는 그대로다");
  editorA.chain().setTextSelection(2).insertContent("X").run();
  assert.deepEqual(save(docA), first, "다른 곳을 고쳐 다시 저장해도 새 블록의 식별자가 같다");
  editorB.chain().setTextSelection(2).insertContent("Y").run();
  assert.deepEqual(save(docB), first, "다른 기기가 저장해도 같은 식별자를 보낸다");
});
