import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";

test("업무함 피드백 대기 행의 확인: 행이 바로 빠지고 되돌리기는 확인을 취소해 다시 보이며, 실패하면 행을 되돌린다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/dashboard/admin?section=work" });
  const names = [
    "window", "self", "document", "navigator", "Event", "CustomEvent", "KeyboardEvent", "PointerEvent", "Node", "Element", "HTMLElement",
    "HTMLInputElement", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT", "React",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<string, unknown> = {
    window: browserWindow,
    self: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Event: browserWindow.Event,
    CustomEvent: browserWindow.CustomEvent,
    KeyboardEvent: browserWindow.KeyboardEvent,
    PointerEvent: browserWindow.PointerEvent,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    MutationObserver: browserWindow.MutationObserver,
    ResizeObserver: browserWindow.ResizeObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
    cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  }


  const { createRoot } = await import("react-dom/client");
  const { AdminWorkQueueSection } = await import("./AdminWorkQueueSection");
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    for (const name of [...names].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  const calls: [string, boolean][] = [];
  let failNext = false;
  const setReviewed = async (assignmentId: string, reviewed: boolean) => {
    calls.push([assignmentId, reviewed]);
    if (failNext) {
      failNext = false;
      return { success: false as const, error: "피드백이 달린 제출은 확인함으로 표시하지 않습니다." };
    }
    return { success: true as const, reviewedAt: reviewed ? new Date() : null };
  };
  const referenceTime = new Date("2026-11-09T00:00:00.000Z");
  const pending = [
    { id: "a1", mediaUrl: null, taskTitle: "테크노 셋 #2", submittedAt: new Date("2026-10-23T12:40:00.000Z"), studentId: "s1", studentName: "김학생", studentEmail: "kim@example.test" },
    { id: "a2", mediaUrl: null, taskTitle: "하우스 롱셋", submittedAt: new Date("2026-10-24T12:40:00.000Z"), studentId: "s2", studentName: "이학생", studentEmail: "lee@example.test" },
  ];
  const students = [{
    id: "s1", email: "kim@example.test", displayName: "김학생", createdAt: null, currentModule: null,
    nextLessonDate: new Date("2026-11-12T10:00:00.000Z"), pendingFeedbackCount: 1, openQnaCount: 0,
  }];
  const render = () => act(async () => {
    root.render(React.createElement(AdminWorkQueueSection, {
      students,
      threads: [],
      pendingAssignments: pending,
      referenceTime,
      onOpenSchedule: () => undefined,
      pushOwnerId: "admin-1",
      lessonNoteIds: { "s1:2026-11-12": "note-1" },
      setReviewed,
    }));
  });
  await render();
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const ackButton = (title: string) => container.querySelector(`button[aria-label="${title} 확인함으로 표시"]`) as HTMLButtonElement | null;
  const rowLinks = () => [...container.querySelectorAll('a[href*="/dashboard/student/assignments/"]')].map((link) => link.getAttribute("href"));

  assert.deepEqual(rowLinks(), [
    "/dashboard/student/assignments/a1?from=work&returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dwork",
    "/dashboard/student/assignments/a2?from=work&returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dwork",
  ], "업무함에서 연 과제는 다음 항목으로 이어지게 from=work를 붙인다");
  // 다가오는 레슨 행: 그 날짜 노트가 있으면 노트 열기.
  const noteLink = [...container.querySelectorAll("a")].find((link) => link.textContent?.includes("노트 열기"));
  assert.equal(noteLink?.getAttribute("href"), "/dashboard/notes/note-1?returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dwork");
  // 휴대폰에서도 머리 링크를 숨기지 않는다.
  const headerLinks = [...container.querySelectorAll("a, button")].filter((node) => ["전체 Q&A", "일정 열기"].includes(node.textContent?.trim() ?? ""));
  assert.equal(headerLinks.length, 2);
  assert.ok(headerLinks.every((node) => !/\bhidden\b/u.test(node.getAttribute("class") ?? "")));

  // 확인: 행이 바로 빠지고 되돌리기 안내가 보인다.
  await act(async () => { ackButton("테크노 셋 #2")?.click(); });
  assert.equal(ackButton("테크노 셋 #2"), null, "확인한 행은 목록에서 빠진다");
  await flush();
  assert.deepEqual(calls, [["a1", true]]);
  const status = container.querySelector('[role="status"]');
  assert.match(status?.textContent ?? "", /'테크노 셋 #2'를 확인함으로 표시했습니다/u);
  const undo = [...container.querySelectorAll("button")].find((button) => button.textContent === "되돌리기");
  assert.ok(undo);

  // 되돌리기: 확인을 취소하고 행이 돌아온다.
  await act(async () => { undo.click(); });
  await flush();
  assert.deepEqual(calls, [["a1", true], ["a1", false]]);
  assert.ok(ackButton("테크노 셋 #2"), "되돌리면 행이 다시 보인다");
  assert.equal(container.querySelector('[role="status"]')?.textContent ?? "", "");

  // 서버가 거절하면 행을 되돌리고 이유를 알린다.
  const alertRegion = container.querySelector('[role="alert"]');
  assert.ok(alertRegion, "alert 영역은 안내가 없을 때도 붙어 있다");
  assert.equal(alertRegion.textContent, "");
  assert.equal(container.querySelector('[role="status"]'), status, "status 영역도 그대로 붙어 있다");
  failNext = true;
  await act(async () => { ackButton("하우스 롱셋")?.click(); });
  await flush();
  assert.ok(ackButton("하우스 롱셋"), "실패하면 행이 돌아온다");
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /피드백이 달린 제출/u);
  assert.equal(container.querySelector('[role="alert"]'), alertRegion, "role을 바꾸지 않고 같은 alert 영역의 글만 바꾼다");
  assert.equal(status?.textContent ?? "", "", "오류는 status 영역에서 읽지 않는다");

  // 되돌리기 저장이 실패하면 서버는 여전히 확인함이므로 행을 다시 빼고 이유를 알린다.
  await act(async () => { ackButton("테크노 셋 #2")?.click(); });
  await flush();
  failNext = true;
  const undoAgain = [...container.querySelectorAll("button")].find((button) => button.textContent === "되돌리기");
  assert.ok(undoAgain);
  await act(async () => { undoAgain.click(); });
  await flush();
  assert.deepEqual(calls.slice(-2), [["a1", true], ["a1", false]]);
  assert.equal(ackButton("테크노 셋 #2"), null, "취소를 저장하지 못하면 행을 다시 뺀다");
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /피드백이 달린 제출/u);

  // 안내가 보이는 사이 다른 행을 확인하면 되돌리기는 마지막 행을 가리키고 앞 행은 확인함으로 남는다.
  await act(async () => { ackButton("하우스 롱셋")?.click(); });
  await flush();
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /'하우스 롱셋'를 확인함으로 표시했습니다/u);
  const undoLatest = [...container.querySelectorAll("button")].find((button) => button.textContent === "되돌리기");
  await act(async () => { undoLatest?.click(); });
  await flush();
  assert.deepEqual(calls.at(-1), ["a2", false]);
  assert.ok(ackButton("하우스 롱셋"), "마지막 행이 돌아온다");
  assert.equal(ackButton("테크노 셋 #2"), null, "앞 행은 확인함으로 남는다");
});

test("업무함 확인: 앞 행 저장이 늦게 실패해도 다른 행의 되돌리기를 가리지 않고, 같은 행의 늦은 결과는 최신 요청을 뒤집지 않는다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/dashboard/admin?section=work" });
  const names = [
    "window", "self", "document", "navigator", "Event", "CustomEvent", "KeyboardEvent", "PointerEvent", "Node", "Element", "HTMLElement",
    "HTMLInputElement", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT", "React",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<string, unknown> = {
    window: browserWindow,
    self: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Event: browserWindow.Event,
    CustomEvent: browserWindow.CustomEvent,
    KeyboardEvent: browserWindow.KeyboardEvent,
    PointerEvent: browserWindow.PointerEvent,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    MutationObserver: browserWindow.MutationObserver,
    ResizeObserver: browserWindow.ResizeObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
    cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  }
  const { createRoot } = await import("react-dom/client");
  const { AdminWorkQueueSection } = await import("./AdminWorkQueueSection");
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    for (const name of [...names].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  type Result = { success: true; reviewedAt: Date | null } | { success: false; error: string };
  const calls: [string, boolean][] = [];
  // 늦게 끝낼 요청을 이름으로 잡아 둔다. 나머지는 바로 성공한다.
  const held = new Map<string, (result: Result) => void>();
  let holdNext: string | null = null;
  const setReviewed = (assignmentId: string, reviewed: boolean) => new Promise<Result>((resolve) => {
    calls.push([assignmentId, reviewed]);
    if (holdNext) {
      held.set(holdNext, resolve);
      holdNext = null;
      return;
    }
    resolve({ success: true, reviewedAt: reviewed ? new Date() : null });
  });
  const pending = [
    { id: "a1", mediaUrl: null, taskTitle: "테크노 셋 #2", submittedAt: new Date("2026-10-23T12:40:00.000Z"), studentId: "s1", studentName: "김학생", studentEmail: "kim@example.test" },
    { id: "a2", mediaUrl: null, taskTitle: "하우스 롱셋", submittedAt: new Date("2026-10-24T12:40:00.000Z"), studentId: "s2", studentName: "이학생", studentEmail: "lee@example.test" },
  ];
  await act(async () => {
    root.render(React.createElement(AdminWorkQueueSection, {
      students: [],
      threads: [],
      pendingAssignments: pending,
      referenceTime: new Date("2026-11-09T00:00:00.000Z"),
      onOpenSchedule: () => undefined,
      pushOwnerId: "admin-1",
      setReviewed,
    }));
  });
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const ackButton = (title: string) => container.querySelector(`button[aria-label="${title} 확인함으로 표시"]`) as HTMLButtonElement | null;
  const undoButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "되돌리기");
  const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? "";

  // A 확인(늦게 실패) → B 확인 → A 실패 도착: A는 돌아오고 B의 되돌리기는 남는다.
  holdNext = "a1-ack";
  await act(async () => { ackButton("테크노 셋 #2")?.click(); });
  await act(async () => { ackButton("하우스 롱셋")?.click(); });
  await flush();
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /'하우스 롱셋'/u);
  await act(async () => held.get("a1-ack")?.({ success: false, error: "피드백이 달린 제출은 확인함으로 표시하지 않습니다." }));
  await flush();
  assert.ok(ackButton("테크노 셋 #2"), "실패한 앞 행은 바로 돌아온다");
  assert.ok(undoButton(), "다른 행의 되돌리기는 남는다");
  assert.equal(alertText(), "", "오류는 되돌리기 안내를 덮지 않고 기다린다");
  await act(async () => { undoButton()?.click(); });
  await flush();
  assert.deepEqual(calls.at(-1), ["a2", false]);
  assert.ok(ackButton("하우스 롱셋"));
  assert.match(alertText(), /피드백이 달린 제출/u, "되돌리기 뒤 미뤄 둔 오류를 알린다");

  // 같은 행: 확인(늦게 네트워크 실패) → 되돌리기 → 다시 확인. 늦은 실패가 마지막 확인을 뒤집지 않는다.
  holdNext = "a1-first";
  await act(async () => { ackButton("테크노 셋 #2")?.click(); });
  await act(async () => { undoButton()?.click(); });
  await act(async () => { ackButton("테크노 셋 #2")?.click(); });
  await act(async () => held.get("a1-first")?.({ success: false, error: "네트워크 오류" }));
  await flush();
  assert.deepEqual(calls.slice(-3), [["a1", true], ["a1", false], ["a1", true]], "서버에는 보낸 순서대로 간다");
  assert.equal(ackButton("테크노 셋 #2"), null, "마지막 의도(확인함)대로 행은 빠져 있다");
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /'테크노 셋 #2'/u, "마지막 확인의 되돌리기 안내가 남는다");
  assert.ok(undoButton());
});
