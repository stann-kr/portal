/**
 * 관리자 일정에서 그룹레슨을 하나로 합쳐 보여 주기(DB 없음). 같은 그룹 + 같은 시작 시각의 포탈 레슨이 멤버 모두에게
 * 있으면 한 블록으로 합친다(2026-11-15 사용자 결정). 저장은 학생별 레슨 행 그대로이고, 합친 블록을 옮기거나 지우면
 * 서버가 멤버 레슨을 함께 바꾼다(src/lib/actions/lessons.ts). 화면 목록에 다시 넣을 때는 expandGroupLessonItem으로 푼다.
 */
import type { LessonGroupSummary } from "@/lib/lesson-group-rules";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export type GroupLessonMember = { lessonId: string; studentId: string; label: string; title: string };
export type GroupLessonMetadata = { groupId: string; groupName: string; members: GroupLessonMember[] };

export const GROUP_LESSON_TITLE = "그룹레슨";

/** 포탈 레슨과 학생 바깥 캘린더의 레슨(subType LESSON) 모두 같은 규칙으로 합친다(캔버스 GroupLesson ②). */
function isLessonItem(item: UnifiedItem): boolean {
  return item.type === "EVENT" && item.subType === "LESSON";
}

export function readGroupLessonMetadata(item: UnifiedItem): GroupLessonMetadata | null {
  const value = item.metadata?.groupLesson as GroupLessonMetadata | undefined;
  return value && Array.isArray(value.members) && value.members.length > 1 ? value : null;
}

/**
 * 멤버 모두에게 같은 시각 레슨이 있는 그룹레슨만 한 항목으로 합친다. 합친 항목은 첫 멤버 레슨의 id와 출처를 그대로 써서
 * 선택·딥링크 키가 바뀌지 않게 하고, 제목은 "그룹레슨 · 그룹 이름", 학생 칸은 멤버 이름을 잇는다. 나머지 항목은 순서 그대로 둔다.
 */
export function mergeGroupLessonItems(items: readonly UnifiedItem[], groups: readonly LessonGroupSummary[]): UnifiedItem[] {
  if (groups.length === 0) return [...items];
  const groupOf = new Map<string, LessonGroupSummary>();
  for (const group of groups) {
    if (group.memberIds.length < 2) continue;
    for (const id of group.memberIds) groupOf.set(id, group);
  }
  const buckets = new Map<string, UnifiedItem[]>();
  for (const item of items) {
    if (!isLessonItem(item) || readGroupLessonMetadata(item)) continue;
    const group = groupOf.get(item.space.studentId);
    if (!group) continue;
    // 출처가 다른 레슨(포탈·바깥 캘린더)은 서로 합치지 않는다.
    const key = `${group.id}\u0000${item.date.getTime()}\u0000${item.source.kind}\u0000${item.source.entity}`;
    const bucket = buckets.get(key) ?? [];
    // 한 학생이 같은 시각에 레슨을 둘 가진 경우 첫 것만 묶는다.
    if (!bucket.some((other) => other.space.studentId === item.space.studentId)) bucket.push(item);
    buckets.set(key, bucket);
  }
  const replaced = new Map<UnifiedItem, UnifiedItem | null>();
  for (const bucket of buckets.values()) {
    const group = groupOf.get(bucket[0].space.studentId)!;
    if (bucket.length !== group.memberIds.length) continue;
    const ordered = [...bucket].sort((a, b) => group.memberIds.indexOf(a.space.studentId) - group.memberIds.indexOf(b.space.studentId));
    const [head] = ordered;
    const metadata: GroupLessonMetadata = {
      groupId: group.id,
      groupName: group.name,
      members: ordered.map((item) => ({ lessonId: item.id, studentId: item.space.studentId, label: item.space.label, title: item.title })),
    };
    replaced.set(head, {
      ...head,
      title: `${GROUP_LESSON_TITLE} · ${group.name}`,
      metadata: { ...head.metadata, groupLesson: metadata },
      space: { studentId: head.space.studentId, label: ordered.map((item) => item.space.label).join(" · ") },
    });
    for (const item of ordered.slice(1)) replaced.set(item, null);
  }
  if (replaced.size === 0) return [...items];
  const merged: UnifiedItem[] = [];
  for (const item of items) {
    const next = replaced.has(item) ? replaced.get(item) : item;
    if (next) merged.push(next);
  }
  return merged;
}

/** 합친 그룹레슨 항목을 멤버별 레슨 항목으로 푼다(날짜는 합친 항목 값). 그룹레슨이 아니면 그대로 하나. */
export function expandGroupLessonItem(item: UnifiedItem): UnifiedItem[] {
  const group = readGroupLessonMetadata(item);
  if (!group) return [item];
  const { groupLesson: _groupLesson, ...metadata } = item.metadata;
  void _groupLesson;
  return group.members.map((member) => ({
    ...item,
    id: member.lessonId,
    title: member.title,
    metadata,
    space: { studentId: member.studentId, label: member.label },
  }));
}

export type StudentGroupLessonTag = { groupName: string; partnerNames: string[] };

export function readStudentGroupLessonTag(item: UnifiedItem): StudentGroupLessonTag | null {
  const value = item.metadata?.studentGroupLesson as StudentGroupLessonTag | undefined;
  return value && typeof value.groupName === "string" ? value : null;
}

/**
 * 학생 화면: 본인 포탈 레슨 중 그룹 멤버 모두 같은 시각인 레슨에 "그룹레슨" 표시를 붙인다(캔버스 GroupLesson ④).
 * 다른 학생의 레슨은 넣지 않고 이름만 붙인다.
 */
export function tagStudentGroupLessons(
  items: readonly UnifiedItem[],
  group: { name: string; partnerNames: string[]; sharedLessonStarts: number[] } | null,
): UnifiedItem[] {
  if (!group || group.sharedLessonStarts.length === 0) return [...items];
  const shared = new Set(group.sharedLessonStarts);
  return items.map((item) =>
    item.type === "EVENT" && item.source.kind === "PORTAL" && item.source.entity === "LESSON" && shared.has(item.date.getTime())
      ? {
        ...item,
        title: `${GROUP_LESSON_TITLE} · ${group.name}`,
        metadata: { ...item.metadata, studentGroupLesson: { groupName: group.name, partnerNames: group.partnerNames } },
      }
      : item);
}

/** 학생이 그룹레슨을 옮기면 더 이상 같은 시각이 아니므로 표시를 뗀다(새로 받으면 서버가 다시 정한다). */
export function untagStudentGroupLesson(item: UnifiedItem): UnifiedItem {
  if (!readStudentGroupLessonTag(item)) return item;
  const { studentGroupLesson: _tag, ...metadata } = item.metadata;
  void _tag;
  return { ...item, title: "레슨", metadata };
}
