import assert from "node:assert/strict";
import { test } from "node:test";
import { sharedLessonStarts } from "@/lib/lesson-group-rules";
import { formatGroupLessonLabel } from "@/components/student-portal/TodaySection";

test("그룹레슨은 멤버 모두에게 같은 시작 시각으로 있는 레슨만 묶는다", () => {
  assert.deepEqual(sharedLessonStarts([[300, 100, 200], [200, 100, 400]]), [100, 200]);
  assert.deepEqual(sharedLessonStarts([[100, 200]]), []);
  assert.deepEqual(sharedLessonStarts([[100], [100], [200]]), []);
});

test("학생 홈 다음 레슨 줄은 같은 시각 레슨일 때만 그룹과 함께하는 학생을 덧붙인다", () => {
  const at = new Date("2026-11-18T10:00:00.000Z");
  const group = { name: "화요일반", partnerNames: ["이학생"], sharedLessonStarts: [at.getTime()] };
  assert.equal(formatGroupLessonLabel(group, at), "그룹레슨 · 화요일반 · 이학생님과 함께");
  assert.equal(formatGroupLessonLabel(group, new Date("2026-11-19T10:00:00.000Z")), null);
});
