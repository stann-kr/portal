import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { EditorInsertPanel } from "@/components/editor/EditorInsertPanel";

test("삽입 패널 Enter는 바깥 문서 form을 제출하지 않고 선택한 삽입만 실행한다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/editor" });
  const testGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    React?: typeof React;
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousHtmlInput = globalThis.HTMLInputElement;
  const previousActEnvironment = testGlobals.IS_REACT_ACT_ENVIRONMENT;
  const previousReact = testGlobals.React;
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLInputElement: browserWindow.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  });

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  let insertCount = 0;
  let closeCount = 0;
  let submitCount = 0;
  const chain = {
    focus: () => chain,
    insertContent: () => chain,
    run: () => {
      insertCount += 1;
      return true;
    },
    setLink: () => chain,
    setTextSelection: () => chain,
  };
  const editor = {
    chain: () => chain,
    commands: { focus: () => true },
    getAttributes: () => ({ href: "https://example.com" }),
    state: { doc: { textBetween: () => "" } },
  } as unknown as Editor;

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    Object.assign(globalThis, {
      window: previousWindow,
      document: previousDocument,
      HTMLInputElement: previousHtmlInput,
      IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      React: previousReact,
    });
  });

  await act(async () => {
    root.render(
      React.createElement(
        "form",
        {
          onSubmit: (event: React.FormEvent) => {
            event.preventDefault();
            submitCount += 1;
          },
        },
        React.createElement(EditorInsertPanel, {
          editor,
          kind: "link",
          selection: { from: 1, to: 1 },
          onClose: () => {
            closeCount += 1;
          },
        }),
      ),
    );
  });

  assert.equal(container.querySelectorAll("form").length, 1);
  const urlInput = container.querySelector('input[type="url"]') as unknown as
    | HTMLInputElement
    | null;
  assert.ok(urlInput);
  const enterEvent = new browserWindow.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Enter",
  });
  await act(async () => {
    urlInput.dispatchEvent(enterEvent as unknown as Event);
  });

  assert.equal(enterEvent.defaultPrevented, true);
  assert.equal(insertCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(submitCount, 0);
});
