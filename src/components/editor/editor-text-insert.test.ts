import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import { Editor } from "@tiptap/core";
import { insertEditorLink } from "./EditorInsertPanel";
import { createFullEditorExtensions } from "./full-editor-extensions";

const DOM_GLOBALS = [
  "window", "document", "navigator", "Node", "Element", "HTMLElement", "DOMParser", "MutationObserver",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "Text", "DocumentFragment", "KeyboardEvent", "Event", "MouseEvent",
] as const;

/**
 * 실제 Tiptap 편집기(전체 확장 포함)를 happy-dom에 띄운다.
 * tiptap-markdown이 insertContent의 문자열을 markdown으로 다시 읽기 때문에, 글자 그대로 넣어야 하는 경로는 실제 확장 묶음으로만 확인된다.
 */
function mountEditor(context: TestContext, content: string): { editor: Editor; window: Window } {
  const window = new Window({ url: "https://portal.test" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of DOM_GLOBALS) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "window" ? window : (window as unknown as Record<string, unknown>)[key];
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const editor = new Editor({
    element: window.document.createElement("div") as unknown as HTMLElement,
    extensions: createFullEditorExtensions(),
    content,
  });
  context.after(() => {
    editor.destroy();
    for (const key of DOM_GLOBALS) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  });
  return { editor, window };
}

function pressTab(editor: Editor, window: Window): boolean {
  const event = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
}

test("코드 블록의 Tab은 공백 두 칸을 넣고, 선택한 글자는 공백으로 바뀐다", (context) => {
  const { editor, window } = mountEditor(context, "<pre><code>ab</code></pre><p>end</p>");
  editor.commands.setTextSelection(2);
  assert.equal(pressTab(editor, window), true);
  assert.equal(editor.state.doc.firstChild?.textContent, "a  b");

  editor.commands.setTextSelection({ from: 1, to: 2 });
  pressTab(editor, window);
  assert.equal(editor.state.doc.firstChild?.textContent, "    b");
});

test("링크 삽입의 표시 글자는 markdown으로 다시 읽지 않고 그 글자에만 링크를 건다", (context) => {
  const { editor } = mountEditor(context, "<p>end</p>");
  editor.commands.setTextSelection(1);
  insertEditorLink(editor, { from: 1, to: 1 }, "**중요** 자료", "https://example.com/a");
  const runs: Array<[string, string[]]> = [];
  editor.state.doc.firstChild?.forEach((node) => {
    runs.push([node.text ?? "", node.marks.map((mark) => mark.type.name)]);
  });
  assert.deepEqual(runs, [
    ["**중요** 자료", ["link"]],
    ["end", []],
  ]);
});
