import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarItemHref,
  findDeepLinkedItem,
  parseCalendarDateParam,
  parseDeepLinkId,
  resolvePortalDeepLink,
  resolveStudentDeepLink,
} from "./portal-location";
import { analysisWriteHref, assignmentTaskHref } from "./student-space-routes";

test("캘린더 날짜 딥링크는 실제로 있는 YYYY-MM-DD만 받는다", () => {
  assert.equal(parseCalendarDateParam("2026-11-09"), "2026-11-09");
  assert.equal(parseCalendarDateParam("2028-02-29"), "2028-02-29");
  for (const value of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-09", "20261109", " 2026-11-09", "2026-11-09T00:00", "", null, undefined]) {
    assert.equal(parseCalendarDateParam(value), null, String(value));
  }
});

test("딥링크 id는 안전한 문자 집합·길이만 받는다", () => {
  assert.equal(parseDeepLinkId("task_1-a"), "task_1-a");
  assert.equal(parseDeepLinkId("PORTAL:EVENT:abc"), "PORTAL:EVENT:abc");
  for (const value of ["", "a/b", "a b", "<x>", "a".repeat(201), null, undefined]) {
    assert.equal(parseDeepLinkId(value), null, String(value));
  }
});

test("주소의 task·date·item을 형식만 검사해 읽고 item은 date가 있어야 받는다", () => {
  assert.deepEqual(resolvePortalDeepLink({ task: "t1", date: "2026-11-09", item: "i1" }), {
    taskId: "t1", date: "2026-11-09", itemId: "i1",
  });
  assert.deepEqual(resolvePortalDeepLink({ task: ["t1", "t2"], item: "i1" }), {
    taskId: "t1", date: null, itemId: null,
  });
  assert.deepEqual(resolvePortalDeepLink({ task: "../x", date: "2026-02-30", item: "i1" }), {
    taskId: null, date: null, itemId: null,
  });
});

test("학생 딥링크는 현재 학생의 과제·항목 목록에 있을 때만 남는다", () => {
  const items = [
    { id: "a", kind: "PORTAL:EVENT" },
    { id: "dup", kind: "PORTAL:NOTE" },
    { id: "dup", kind: "PORTAL:EVENT" },
  ];
  const keyOf = (item: { id: string; kind: string }) => `${item.kind}:${item.id}`;
  const owned = { taskIds: ["mine"], items, keyOf };
  assert.deepEqual(
    resolveStudentDeepLink({ taskId: "mine", date: "2026-11-09", itemId: "a" }, owned),
    { initialOpenTaskId: "mine", calendarDate: "2026-11-09", calendarItemKey: "PORTAL:EVENT:a" },
  );
  assert.deepEqual(
    resolveStudentDeepLink({ taskId: "someone-else", date: "2026-11-09", itemId: "missing" }, owned),
    { initialOpenTaskId: null, calendarDate: "2026-11-09", calendarItemKey: null },
  );
  assert.equal(findDeepLinkedItem(items, "dup", keyOf), null, "겹치는 id는 고르지 않는다");
  assert.equal(findDeepLinkedItem(items, "PORTAL:NOTE:dup", keyOf), items[1]);
  assert.equal(findDeepLinkedItem(items, null, keyOf), null);
});

test("딥링크 주소 helper", () => {
  assert.equal(assignmentTaskHref("t 1"), "/dashboard/student?section=workspace&view=assignments&task=t%201", "예전 주소 redirect 없이 정식 주소");
  assert.equal(assignmentTaskHref("t1", { analysis: true }), analysisWriteHref("t1"));
  assert.equal(
    calendarItemHref("2026-11-09", "PORTAL:EVENT:a"),
    "/dashboard/student?section=workspace&view=calendar&date=2026-11-09&item=PORTAL%3AEVENT%3Aa",
  );
  assert.equal(calendarItemHref("2026-11-09"), "/dashboard/student?section=workspace&view=calendar&date=2026-11-09");
  const parsed = resolvePortalDeepLink(Object.fromEntries(new URL(calendarItemHref("2026-11-09", "PORTAL:EVENT:a"), "http://x").searchParams));
  assert.deepEqual(parsed, { taskId: null, date: "2026-11-09", itemId: "PORTAL:EVENT:a" });
});
