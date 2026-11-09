import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
// 정적 import: 컴포넌트와 같은(CJS) Radix 사본을 써야 Menu context가 이어진다.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

let createRoot: typeof import("react-dom/client").createRoot;
let ThemeModeMenuGroup: typeof import("@/components/theme/ThemeModeMenuGroup").ThemeModeMenuGroup;
let browser: Window;
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "https://portal.test/dashboard" });
  const bindings = {
    window: browser,
    self: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Node: browser.Node,
    Element: browser.Element,
    Event: browser.Event,
    CustomEvent: browser.CustomEvent,
    KeyboardEvent: browser.KeyboardEvent,
    MouseEvent: browser.MouseEvent,
    PointerEvent: browser.PointerEvent,
    FocusEvent: browser.FocusEvent,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: browser.ResizeObserver,
    DOMRect: browser.DOMRect,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    // Node의 BroadcastChannel은 열려 있으면 테스트 process가 끝나지 않는다. 탭 동기화는 이 테스트 범위 밖.
    BroadcastChannel: undefined,
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const [name, value] of Object.entries(bindings)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ ThemeModeMenuGroup } = await import("@/components/theme/ThemeModeMenuGroup"));
});

after(() => {
  browser.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function renderMenu(context: TestContext, size: "md" | "touch") {
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  context.after(async () => {
    await act(async () => root.unmount());
    // Radix focus scope는 닫힌 뒤 한 tick 늦게 focus 이벤트를 보낸다. 전역을 되돌리기 전에 끝낸다.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    container.remove();
  });
  await act(async () => root.render(
    <DropdownMenu.Root open modal={false}>
      <DropdownMenu.Trigger>계정 메뉴</DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <ThemeModeMenuGroup size={size} />
        <DropdownMenu.Item>이 기기의 초안</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>,
  ));
  return container;
}

function radios() {
  return [...browser.document.querySelectorAll('[role="menuitemradio"]')] as unknown as HTMLElement[];
}

test("계정 메뉴 화면 모드: 시스템·라이트·다크 세 칸, 고르면 바로 data-theme·cookie에 반영하고 메뉴는 열린 채로 둔다", async (context) => {
  const html = browser.document.documentElement;
  delete html.dataset.theme;
  browser.document.cookie = "portal-theme=; Max-Age=0; Path=/";
  await renderMenu(context, "touch");

  const group = browser.document.querySelector('[role="group"][aria-labelledby]');
  assert.ok(group, "radio 묶음이 있어야 한다");
  const label = browser.document.getElementById(group.getAttribute("aria-labelledby") ?? "");
  assert.equal(label?.textContent, "화면 모드");
  assert.deepEqual(radios().map((radio) => radio.textContent), ["시스템", "라이트", "다크"]);
  assert.deepEqual(radios().map((radio) => radio.getAttribute("aria-checked")), ["true", "false", "false"]);
  // 휴대폰 메뉴 서랍에서는 누르는 곳 44px.
  for (const radio of radios()) assert.match(radio.className, /(^|\s)h-11(\s|$)/);
  // 화면 모드가 메뉴 맨 위(첫 항목보다 앞)에 있다.
  const firstItem = browser.document.querySelector('[role="menuitem"]');
  assert.ok(firstItem && radios()[0].compareDocumentPosition(firstItem as unknown as Node) & 4);

  await act(async () => { radios()[2].click(); });
  assert.equal(html.dataset.theme, "dark");
  assert.match(browser.document.cookie, /portal-theme=dark/);
  assert.deepEqual(radios().map((radio) => radio.getAttribute("aria-checked")), ["false", "false", "true"]);
  assert.equal(radios().length, 3, "고른 뒤에도 메뉴가 열려 있어야 한다");

  await act(async () => { radios()[1].click(); });
  assert.equal(html.dataset.theme, "light");
  assert.match(browser.document.cookie, /portal-theme=light/);

  await act(async () => { radios()[0].click(); });
  assert.equal(html.dataset.theme, undefined);
  assert.doesNotMatch(browser.document.cookie, /portal-theme=/);
  assert.deepEqual(radios().map((radio) => radio.getAttribute("aria-checked")), ["true", "false", "false"]);
});

test("서버가 그린 data-theme을 현재 선택으로 보여 준다", async (context) => {
  browser.document.documentElement.dataset.theme = "light";
  context.after(() => { delete browser.document.documentElement.dataset.theme; });
  await renderMenu(context, "md");
  assert.deepEqual(radios().map((radio) => radio.getAttribute("aria-checked")), ["false", "true", "false"]);
});

test("AccountMenu는 화면 모드를 첫 항목 앞에 두고 구분선으로 나눈다", () => {
  const source = readFileSync(join(process.cwd(), "src/components/app-shell/AccountMenu.tsx"), "utf8");
  const group = source.indexOf("<ThemeModeMenuGroup size={size} />");
  const separator = source.indexOf("<DropdownMenu.Separator", group);
  const firstItem = source.indexOf("<DropdownMenu.Item", group);
  assert.ok(group > 0 && separator > group && firstItem > separator);
});
