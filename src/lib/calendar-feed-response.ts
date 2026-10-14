import { and, asc, eq, gte } from "drizzle-orm";
import { createEvents, type EventAttributes, type ReturnObject } from "ics";
import type { DrizzleDb } from "@/db/client";
import { lessons } from "@/db/schema";
import type { ActiveProfile } from "@/lib/active-profile";

type FeedLesson = { id: string; scheduledAt: Date };

/**
 * 구독 캘린더가 같은 레슨을 같은 항목으로 갱신하도록 레슨 ID 기반 UID를 고정하고,
 * 실행 환경 timezone과 무관하게 UTC 구성요소로 시작 시각을 기록한다.
 */
export function buildLessonCalendarIcs(
  student: Pick<ActiveProfile, "displayName" | "email">,
  lessonList: readonly FeedLesson[],
): ReturnObject {
  const events: EventAttributes[] = lessonList.map((lesson) => {
    const date = lesson.scheduledAt;
    return {
      uid: `${lesson.id}@lessons.stannlumo`,
      start: [
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
      ],
      startInputType: "utc",
      startOutputType: "utc",
      duration: { hours: 1 },
      title: `DJ Lesson — ${student.displayName ?? student.email}`,
      description: "Stann Lumo DJ Lesson",
      organizer: { name: "Stann Lumo", email: "admin@stannlumo.com" },
      status: "CONFIRMED",
      busyStatus: "BUSY",
    };
  });
  return createEvents(events, { productId: "stannlumo/portal", calName: "Stann Lumo DJ 레슨" });
}

export async function createCalendarFeedResponse(
  student: ActiveProfile,
  db: DrizzleDb,
): Promise<Response> {
  const lessonList = await db
    .select()
    .from(lessons)
    .where(
      and(
        eq(lessons.studentId, student.id),
        gte(lessons.scheduledAt, new Date()),
      ),
    )
    .orderBy(asc(lessons.scheduledAt));

  const { error, value } = buildLessonCalendarIcs(student, lessonList);
  if (error || !value) {
    return new Response("Failed to generate calendar", { status: 500 });
  }

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stannlumo-lessons.ics"',
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
