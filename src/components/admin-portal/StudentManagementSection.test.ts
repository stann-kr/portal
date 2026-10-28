import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";

test("roster 행은 요약 열과 더 보기 메뉴의 canonical 학생 링크만 제공하고 검색으로 좁힌다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/dashboard/admin?section=students" });
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

  // React DOM(입력 이벤트 지원)과 Radix(layout effect)는 모듈을 읽을 때 document 유무를 보므로 DOM 전역을 둔 뒤 불러온다.
  const { createRoot } = await import("react-dom/client");
  const { StudentManagementSection } = await import("./StudentManagementSection");
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

  const renderedStudents = [{
    id: "student-1",
    email: "student@example.test",
    displayName: "학생",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    currentModule: "WEEK 01 · 기초",
    nextLessonDate: new Date("2026-08-14T10:00:00.000Z"),
    pendingFeedbackCount: 2,
  }, {
    id: "student-2",
    email: "minji@example.test",
    displayName: "민지",
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    currentModule: null,
    nextLessonDate: null,
    pendingFeedbackCount: 0,
  }];
  await act(async () => {
    root.render(React.createElement(StudentManagementSection, { students: renderedStudents }));
  });

  const rows = () => [...container.querySelectorAll("tbody tr")];
  assert.equal(rows().length, 2);
  const [first] = rows();
  // 커리큘럼 숨김(기본값): 현재 진도 열과 진도 문구가 없다.
  assert.deepEqual([...container.querySelectorAll("thead th")].map((th) => th.textContent), ["수강생", "다음 레슨", "피드백 대기", "메뉴"]);
  assert.doesNotMatch(container.textContent ?? "", /WEEK 01|현재 진도|진도 미지정/u);
  assert.match(first.textContent ?? "", /08\.14 19:00/u, "다음 레슨은 KST 점 날짜와 시각");
  assert.match(first.textContent ?? "", /2건/u, "피드백 대기 수를 함께 읽는다");
  assert.equal(
    first.querySelector("a")?.getAttribute("href"),
    "/dashboard/admin/students/student-1?tab=overview",
    "이름 칸은 학생 상세로 간다",
  );

  const trigger = container.querySelector('button[aria-label="학생 메뉴"]') as HTMLButtonElement | null;
  assert.ok(trigger, "행마다 이름이 붙은 더 보기 메뉴가 있다");
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new browserWindow.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }) as unknown as Event);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const menu = browserWindow.document.querySelector('[role="menu"]');
  assert.ok(menu, "메뉴가 열린다");
  const hrefs = [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.getAttribute("href"));
  assert.deepEqual(hrefs, [
    "/dashboard/admin/students/student-1?tab=overview",
    "/dashboard/admin/students/student-1?tab=assignments",
    "/dashboard/admin/students/student-1?tab=digging",
    "/dashboard/admin/students/student-1/notes",
    "/dashboard/admin/students/student-1?tab=qna",
  ]);
  await act(async () => {
    menu.dispatchEvent(new browserWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  const search = container.querySelector('input[type="search"]') as HTMLInputElement | null;
  assert.ok(search);
  const setter = Object.getOwnPropertyDescriptor(browserWindow.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(search, "MINJI");
    search.dispatchEvent(new browserWindow.Event("input", { bubbles: true }) as unknown as Event);
  });
  assert.deepEqual(rows().map((row) => row.querySelector("a")?.getAttribute("href")), ["/dashboard/admin/students/student-2?tab=overview"]);
  assert.match(rows()[0].textContent ?? "", /minji@example\.test.*미정/u);

  await act(async () => {
    setter.call(search, "없는 학생");
    search.dispatchEvent(new browserWindow.Event("input", { bubbles: true }) as unknown as Event);
  });
  assert.equal(rows().length, 0);
  assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /맞는 수강생이 없습니다/u);

  // 스위치를 켜면 현재 진도 열이 돌아온다.
  await act(async () => {
    setter.call(search, "");
    search.dispatchEvent(new browserWindow.Event("input", { bubbles: true }) as unknown as Event);
  });
  await act(async () => {
    root.render(React.createElement(StudentManagementSection, { students: renderedStudents, showCurriculum: true }));
  });
  assert.ok([...container.querySelectorAll("thead th")].some((th) => th.textContent === "현재 진도"));
  assert.match(rows()[0].textContent ?? "", /WEEK 01 · 기초/u);
  assert.match(rows()[1].textContent ?? "", /진도 미지정/u);
});
