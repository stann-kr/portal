import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";

let createRoot: typeof import("react-dom/client").createRoot;
let RichTextContent: typeof import("@/components/editor/RichTextContent").RichTextContent;
let browser: Window;
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "https://portal.test/dashboard/notes/n-1" });
  const bindings = {
    window: browser,
    self: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    HTMLImageElement: browser.HTMLImageElement,
    Node: browser.Node,
    Element: browser.Element,
    Event: browser.Event,
    CustomEvent: browser.CustomEvent,
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
    MutationObserver: browser.MutationObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const [name, value] of Object.entries(bindings)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ RichTextContent } = await import("@/components/editor/RichTextContent"));
});

after(() => {
  browser.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

async function render(context: TestContext, element: React.ReactElement) {
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  context.after(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(element));
  await settle();
  return container;
}

function dialog() {
  return browser.document.querySelector('[role="dialog"]');
}

function caption() {
  return dialog()?.querySelector("h2")?.textContent ?? "";
}

function viewerImage() {
  return dialog()?.querySelector("img");
}

async function click(element: { click(): void } | null | undefined) {
  assert.ok(element);
  await act(async () => { element.click(); });
  await settle();
}

async function key(element: unknown, value: string, type: "keydown" | "keyup" = "keydown") {
  assert.ok(element);
  const target = element as EventTarget;
  await act(async () => {
    target.dispatchEvent(new browser.KeyboardEvent(type, { key: value, bubbles: true, cancelable: true }) as unknown as Event);
  });
  await settle();
}

const html = [
  "<p>EQ는 이렇게 맞춰 두세요.</p>",
  '<img src="/api/media/a" alt="믹서 EQ 설정">',
  '<p><a href="https://example.com"><img src="/api/media/linked" alt="링크 이미지"></a></p>',
  '<img src="/api/media/b" alt="">',
  '<img src="/api/media/c" alt="셋업 사진">',
].join("");

test("본문 이미지에 확대 표시 자리·키보드 초점을 더하고, 링크 안 이미지는 그대로 둔다", { concurrency: false }, async (context) => {
  const container = await render(context, <RichTextContent html={html} />);
  const images = [...container.querySelectorAll(".rich-text img")];
  assert.equal(images.length, 4);
  const [first, linked, unnamed] = images;
  assert.equal(first.getAttribute("role"), "button");
  assert.equal(first.getAttribute("tabindex"), "0");
  assert.equal(first.getAttribute("aria-label"), "이미지 크게 보기: 믹서 EQ 설정");
  assert.ok(first.parentElement?.classList.contains("rich-text-zoom"));
  assert.equal(unnamed.getAttribute("aria-label"), "이미지 크게 보기");
  assert.equal(linked.getAttribute("role"), null);
  assert.equal(linked.parentElement?.tagName, "A");

  // happy-dom이 실제로 이동하지 않게 링크 이동만 막고, 뷰어가 열리지 않는지 본다.
  let linkClicked = false;
  const stopNavigation = (event: { preventDefault(): void }) => { linkClicked = true; event.preventDefault(); };
  container.addEventListener("click", stopNavigation);
  await click(linked as unknown as HTMLElement);
  container.removeEventListener("click", stopNavigation);
  assert.ok(linkClicked);
  assert.equal(dialog(), null, "링크 안 이미지는 뷰어를 열지 않는다");
});

test("누르면 같은 글 이미지 중 그 위치로 열고, ←/→로 넘기며 Esc로 닫으면 원래 이미지로 초점이 돌아간다", { concurrency: false }, async (context) => {
  const container = await render(context, <RichTextContent html={html} />);
  const images = [...container.querySelectorAll(".rich-text img")] as unknown as HTMLElement[];
  const third = images[3];

  third.focus();
  await click(third);
  assert.ok(dialog());
  assert.equal(caption(), "셋업 사진 · 3 / 3");
  assert.equal(viewerImage()?.getAttribute("src"), "/api/media/c");
  assert.equal(dialog()?.querySelectorAll("a").length, 0, "머리줄에는 닫기만 둔다(원본 열기 없음)");
  assert.equal(browser.document.activeElement?.getAttribute("aria-label"), "닫기");

  await key(browser.document.activeElement, "ArrowRight");
  assert.equal(caption(), "믹서 EQ 설정 · 1 / 3");
  await key(browser.document.activeElement, "ArrowLeft");
  assert.equal(caption(), "셋업 사진 · 3 / 3");
  await click(dialog()?.querySelector('button[aria-label="이전 이미지"]') as unknown as HTMLElement);
  assert.equal(caption(), "이미지 · 2 / 3", "alt가 없으면 '이미지'");

  await key(browser.document.activeElement, "Escape");
  assert.equal(dialog(), null);
  assert.equal(browser.document.activeElement, third);
});

test("이전·다음 버튼으로 넘겨도 초점이 그 버튼에 남아 Enter를 이어 누를 수 있다", { concurrency: false }, async (context) => {
  const container = await render(context, <RichTextContent html={html} />);
  const first = container.querySelector(".rich-text img") as unknown as HTMLElement;
  first.focus();
  await click(first);
  assert.equal(caption(), "믹서 EQ 설정 · 1 / 3");

  const next = dialog()?.querySelector('button[aria-label="다음 이미지"]') as unknown as HTMLElement;
  next.focus();
  await click(next);
  assert.equal(caption(), "이미지 · 2 / 3");
  assert.equal(browser.document.activeElement, next, "넘긴 뒤에도 같은 '다음 이미지' 버튼에 초점");
  await click(browser.document.activeElement as unknown as HTMLElement);
  assert.equal(caption(), "셋업 사진 · 3 / 3");

  const prev = dialog()?.querySelector('button[aria-label="이전 이미지"]') as unknown as HTMLElement;
  prev.focus();
  await click(prev);
  assert.equal(caption(), "이미지 · 2 / 3");
  assert.equal(browser.document.activeElement, prev);
  await key(browser.document.activeElement, "Escape");
});

test("키보드: Enter로 열고, 닫기 버튼으로 닫으면 초점이 돌아간다. 이미지 하나면 넘기기 버튼과 번호가 없다", { concurrency: false }, async (context) => {
  const container = await render(context, <RichTextContent html='<p>하나</p><img src="data:image/png;base64,AAAA" alt="한 장">' />);
  const image = container.querySelector(".rich-text img") as unknown as HTMLElement;
  image.focus();
  await key(image, "Enter");
  assert.ok(dialog());
  assert.equal(caption(), "한 장");
  assert.equal(dialog()?.querySelector('button[aria-label="다음 이미지"]'), null);
  await key(browser.document.activeElement, "ArrowRight");
  assert.equal(caption(), "한 장");

  await click(dialog()?.querySelector('button[aria-label="닫기"]') as unknown as HTMLElement);
  assert.equal(dialog(), null);
  assert.equal(browser.document.activeElement, image);

  // Space는 버튼처럼 뗄 때 연다.
  await key(image, " ");
  assert.equal(dialog(), null);
  await key(image, " ", "keyup");
  assert.ok(dialog());
  await key(browser.document.activeElement, "Escape");
});

test("편집기(.ProseMirror) 안 이미지는 뷰어를 열지 않는다", { concurrency: false }, async (context) => {
  const { isViewerImage } = await import("@/components/editor/ZoomableRichText");
  const root = browser.document.createElement("div");
  root.innerHTML = '<div class="ProseMirror"><img src="/api/media/e" alt="편집 중"></div><img src="/api/media/r" alt="읽기">';
  browser.document.body.append(root);
  context.after(() => root.remove());
  const [editorImage, readImage] = [...root.querySelectorAll("img")];
  assert.equal(isViewerImage(editorImage as unknown as Element, root as unknown as Element), false);
  assert.equal(isViewerImage(readImage as unknown as Element, root as unknown as Element), true);
});
