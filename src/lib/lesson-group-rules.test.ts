import assert from "node:assert/strict";
import { test } from "node:test";
import { groupNoteShareLine, sharedLessonStarts } from "@/lib/lesson-group-rules";
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

test("그룹 노트 안내 줄은 학생 편집을 막으면 읽기 전용으로 바뀐다", () => {
  const group = { name: "화요 그룹", members: [{ id: "s1", name: "김학생" }, { id: "s2", name: "이학생" }] };
  assert.match(groupNoteShareLine(group, { id: "admin", isAdmin: true }), /함께 고칠 수 있어요/u);
  assert.equal(
    groupNoteShareLine(group, { id: "admin", isAdmin: true }, { studentReadOnly: true }),
    "화요 그룹 노트 · 읽기 전용 · 김학생·이학생에게는 보기만 열려 있어요.",
  );
  assert.equal(groupNoteShareLine(group, { id: "s1", isAdmin: false }, { studentReadOnly: true }), "화요 그룹 노트 · Stann이 읽기 전용으로 두었어요.");
});
