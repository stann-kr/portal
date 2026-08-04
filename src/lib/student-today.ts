import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export type StudentTodaySummary = {
  nextCue: UnifiedItem | null;
  feedbackItems: UnifiedItem[];
  answeredQnaItems: UnifiedItem[];
  waitingAssignment: UnifiedItem | null;
  openQnaItems: UnifiedItem[];
};

function newestFirst(a: UnifiedItem, b: UnifiedItem) {
  return b.date.getTime() - a.date.getTime();
}

function oldestFirst(a: UnifiedItem, b: UnifiedItem) {
  return a.date.getTime() - b.date.getTime();
}

function feedbackCount(item: UnifiedItem): number {
  const count = item.metadata.feedbackCount;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

export function getStudentTodaySummary(
  items: UnifiedItem[],
  referenceTime: Date,
): StudentTodaySummary {
  const futureEvents = items
    .filter(
      (item) =>
        item.type === "EVENT" && item.date.getTime() >= referenceTime.getTime(),
    )
    .sort(oldestFirst);
  const nextCue =
    futureEvents.find((item) => item.subType === "LESSON") ??
    futureEvents[0] ??
    null;

  const assignments = items
    .filter((item) => item.type === "ASSIGNMENT")
    .sort(newestFirst);
  const qnaItems = items.filter((item) => item.type === "QNA").sort(newestFirst);

  return {
    nextCue,
    feedbackItems: assignments.filter((item) => feedbackCount(item) > 0).slice(0, 3),
    answeredQnaItems: qnaItems
      .filter((item) => item.subType === "ANSWERED")
      .slice(0, 3),
    waitingAssignment:
      assignments.find((item) => feedbackCount(item) === 0) ?? null,
    openQnaItems: qnaItems.filter((item) => item.subType === "OPEN").slice(0, 3),
  };
}
