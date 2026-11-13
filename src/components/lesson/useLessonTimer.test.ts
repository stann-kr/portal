import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { lessonTimerScope, useLessonTimer } from "./useLessonTimer";

type Timer = ReturnType<typeof useLessonTimer>;

const BINDINGS = ["window", "document", "navigator", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"] as const;

/** 같은 탭의 새로고침은 window를 새로 만들되 localStorage·sessionStorage 내용은 이어 준다. */
function installWindow(context: TestContext, seed?: { local: Record<string, string>; session: Record<string, string> }) {
  const browserWindow = new Window({ url: "https://portal.test/notes/new" });
  for (const [key, value] of Object.entries(seed?.local ?? {})) browserWindow.localStorage.setItem(key, value);
  for (const [key, value] of Object.entries(seed?.session ?? {})) browserWindow.sessionStorage.setItem(key, value);
  const previous = new Map(BINDINGS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const values: Record<(typeof BINDINGS)[number], unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    HTMLElement: browserWindow.HTMLElement,
    Node: browserWindow.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of BINDINGS) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  const restore = () => {
    for (const name of BINDINGS) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    void browserWindow.happyDOM.close();
  };
  context.after(restore);
  return { browserWindow, restore };
}

function snapshot(storage: { length: number; key(index: number): string | null; getItem(key: string): string | null }) {
  const values: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)!;
    values[key] = storage.getItem(key)!;
  }
  return values;
}

async function mountTimer(scopeId: string) {
  let latest: Timer | null = null;
  function Probe({ scope }: { scope: string }) {
    latest = useLessonTimer(scope);
    return null;
  }
  const container = document.createElement("div");
  const root: Root = createRoot(container as unknown as Element);
  await act(async () => root.render(React.createElement(Probe, { scope: scopeId })));
  return {
    get: () => latest!,
    rerender: (scope: string) => act(async () => root.render(React.createElement(Probe, { scope }))),
    unmount: () => act(async () => root.unmount()),
  };
}

test("새 노트 타이머는 같은 탭 새로고침 뒤 이어지고, 새 탭의 새 작성 화면은 0부터 시작한다", async (context) => {
  const scope = lessonTimerScope(null, "student-1");
  const first = installWindow(context);
  const timer = await mountTimer(scope);
  assert.equal(timer.get().started, false);
  await act(async () => timer.get().toggle());
  assert.equal(timer.get().running, true);
  await timer.unmount();
  const stored = { local: snapshot(first.browserWindow.localStorage), session: snapshot(first.browserWindow.sessionStorage) };
  first.restore();

  // 같은 탭 새로고침: 기기·탭 보관 값이 남아 있어 이어서 잰다.
  const reloaded = installWindow(context, stored);
  const resumed = await mountTimer(scope);
  assert.equal(resumed.get().running, true);
  assert.equal(resumed.get().started, true);
  await resumed.unmount();
  const afterReload = snapshot(reloaded.browserWindow.localStorage);
  reloaded.restore();

  // 새 탭(같은 기기, 탭 보관 없음)에서 연 새 작성 화면은 전에 쓰다 만 시간을 이어받지 않는다.
  const freshTab = installWindow(context, { local: afterReload, session: {} });
  const fresh = await mountTimer(scope);
  assert.equal(fresh.get().started, false);
  await fresh.unmount();
  freshTab.restore();
});

test("노트가 만들어지면 시간을 노트로 옮기고, 초기화하면 보관 값을 지운다", async (context) => {
  const newScope = lessonTimerScope(null, "student-1");
  const { browserWindow } = installWindow(context);
  // 시작과 멈춤이 같은 1ms 안에 끝나면 잰 시간이 0이라 "시작 안 함"이 된다. 시계를 호출마다 1초씩 보낸다.
  let clock = Date.parse("2026-11-13T12:00:00Z");
  context.mock.method(Date, "now", () => (clock += 1_000));
  const timer = await mountTimer(newScope);
  await act(async () => timer.get().toggle());
  await act(async () => timer.get().toggle());
  await timer.rerender("note-1");
  assert.equal(timer.get().started, true);
  assert.equal(browserWindow.localStorage.getItem("portal:lesson-timer:new:student-1"), null);
  assert.notEqual(browserWindow.localStorage.getItem("portal:lesson-timer:note-1"), null);
  assert.equal(browserWindow.sessionStorage.length, 0);

  await act(async () => timer.get().reset());
  assert.equal(timer.get().started, false);
  assert.equal(browserWindow.localStorage.getItem("portal:lesson-timer:note-1"), null);
  await timer.unmount();
});

test("첫 render는 서버와 같이 0이고 저장소는 mount 뒤에만 읽는다", () => {
  function Probe() {
    const timer = useLessonTimer("note-1");
    return React.createElement("span", null, `${timer.started}:${timer.elapsedSeconds}`);
  }
  assert.equal(renderToString(React.createElement(Probe)), "<span>false:0</span>");
});
