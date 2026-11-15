import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expandGroupLessonItem,
  mergeGroupLessonItems,
  readGroupLessonMetadata,
  tagStudentGroupLessons,
  untagStudentGroupLesson,
} from "@/lib/group-lesson-items";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

function lesson(id: string, studentId: string, label: string, iso: string, kind: "PORTAL" | "GOOGLE" = "PORTAL"): UnifiedItem {
  return {
    id,
    type: "EVENT",
    subType: "LESSON",
    title: kind === "PORTAL" ? "레슨" : "DJ 레슨",
    date: new Date(iso),
    endDate: null,
    metadata: {},
    space: { studentId, label },
    source: kind === "PORTAL" ? { kind: "PORTAL", entity: "LESSON", label: "포탈" } : { kind: "GOOGLE", entity: "EXTERNAL", label: "Google" },
  } as UnifiedItem;
}

const groups = [{ id: "g1", name: "화요일반", memberIds: ["a", "b"] }];
const at = "2026-11-18T10:00:00.000Z";

test("같은 그룹 + 같은 시각 레슨이 멤버 모두에게 있으면 한 블록으로 합치고, 풀면 멤버별 레슨으로 돌아온다", () => {
  const items = [lesson("l-b", "b", "이학생", at), lesson("l-a", "a", "김학생", at), lesson("l-c", "c", "박학생", at)];
  const merged = mergeGroupLessonItems(items, groups);
  assert.equal(merged.length, 2);
  const block = merged.find((item) => readGroupLessonMetadata(item));
  assert.ok(block);
  assert.equal(block.title, "그룹레슨 · 화요일반");
  assert.equal(block.space.label, "김학생 · 이학생");
  // 첫 멤버(그룹 멤버 순서) 레슨의 id를 써서 선택 키가 바뀌지 않는다.
  assert.equal(block.id, "l-a");
  const moved = { ...block, date: new Date("2026-11-19T10:00:00.000Z") };
  const expanded = expandGroupLessonItem(moved);
  assert.deepEqual(expanded.map((item) => [item.id, item.space.studentId, item.space.label, item.title, item.date.toISOString()]), [
    ["l-a", "a", "김학생", "레슨", "2026-11-19T10:00:00.000Z"],
    ["l-b", "b", "이학생", "레슨", "2026-11-19T10:00:00.000Z"],
  ]);
  assert.equal(readGroupLessonMetadata(expanded[0]), null);
});

test("시각이 다르거나 멤버 일부만 있거나 출처가 다르면 합치지 않는다", () => {
  assert.equal(mergeGroupLessonItems([lesson("l-a", "a", "김학생", at), lesson("l-b", "b", "이학생", "2026-11-18T11:00:00.000Z")], groups).length, 2);
  assert.equal(mergeGroupLessonItems([lesson("l-a", "a", "김학생", at)], groups).length, 1);
  assert.equal(mergeGroupLessonItems([lesson("l-a", "a", "김학생", at), lesson("x-b", "b", "이학생", at, "GOOGLE")], groups).length, 2);
  const external = mergeGroupLessonItems([lesson("x-a", "a", "김학생", at, "GOOGLE"), lesson("x-b", "b", "이학생", at, "GOOGLE")], groups);
  assert.equal(external.length, 1);
  assert.deepEqual(expandGroupLessonItem(external[0]).map((item) => item.title), ["DJ 레슨", "DJ 레슨"]);
});

test("학생 화면은 같은 시각 레슨에만 그룹레슨 표시를 붙이고, 옮기면 뗀다", () => {
  const items = [lesson("l-a", "a", "김학생", at), lesson("l-a2", "a", "김학생", "2026-11-25T10:00:00.000Z")];
  const tagged = tagStudentGroupLessons(items, { name: "화요일반", partnerNames: ["이학생"], sharedLessonStarts: [new Date(at).getTime()] });
  assert.deepEqual(tagged.map((item) => item.title), ["그룹레슨 · 화요일반", "레슨"]);
  assert.deepEqual(tagged[0].metadata.studentGroupLesson, { groupName: "화요일반", partnerNames: ["이학생"] });
  const untagged = untagStudentGroupLesson(tagged[0]);
  assert.equal(untagged.title, "레슨");
  assert.equal("studentGroupLesson" in untagged.metadata, false);
  assert.equal(tagStudentGroupLessons(items, null).length, 2);
});
