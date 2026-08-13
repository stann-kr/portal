import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { StudentManagementSection } from "./StudentManagementSection";

test("roster 인라인 영역은 요약과 canonical 학생 링크만 제공한다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/dashboard/admin?section=students" });
  const names = ["window", "self", "document", "navigator", "Event", "Node", "HTMLElement", "MutationObserver", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT", "React"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<string, unknown> = {
    window: browserWindow,
    self: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    HTMLElement: browserWindow.HTMLElement,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
  }

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

  await act(async () => {
    root.render(React.createElement(StudentManagementSection, {
      students: [{
        id: "student-1",
        email: "student@example.test",
        displayName: "학생",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        currentModule: "1주차: 기초",
        nextLessonDate: new Date("2026-08-14T10:00:00.000Z"),
        pendingFeedbackCount: 2,
      }],
    }));
  });

  const toggle = container.querySelector('button[aria-controls="student-detail-student-1"]') as HTMLButtonElement | null;
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(container.textContent ?? "", /피드백 대기\s*2건/u);
  const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
  assert.ok(hrefs.includes("/dashboard/admin/students/student-1?tab=overview"));
  assert.ok(hrefs.includes("/dashboard/admin/students/student-1/notes"));
  assert.ok(hrefs.includes("/dashboard/admin/students/student-1?tab=qna"));
  assert.ok(hrefs.includes("/dashboard/admin/students/student-1?tab=digging"));
});
