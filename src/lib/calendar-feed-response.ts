import { and, asc, eq, gte } from "drizzle-orm";
import { createEvent, type EventAttributes } from "ics";
import type { DrizzleDb } from "@/db/client";
import { lessons } from "@/db/schema";
import type { ActiveProfile } from "@/lib/active-profile";

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

  const events: EventAttributes[] = lessonList.map((lesson) => {
    const date = lesson.scheduledAt;
    return {
      start: [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
      ],
      duration: { hours: 1 },
      title: `DJ Lesson — ${student.displayName ?? student.email}`,
      description: "Stann Lumo DJ Lesson",
      organizer: { name: "Stann Lumo", email: "admin@stannlumo.com" },
      status: "CONFIRMED",
      busyStatus: "BUSY",
    };
  });

  const { error, value } = createEvent(
    events[0] ?? {
      start: [2026, 1, 1, 12, 0],
      title: "Stann Lumo — No upcoming lessons",
    },
  );
  if (error || !value) {
    return new Response("Failed to generate calendar", { status: 500 });
  }

  let icsContent = value;
  if (events.length > 1) {
    const additionalEvents: string[] = [];
    for (const event of events.slice(1)) {
      const { value: nextCalendar } = createEvent(event);
      const match = nextCalendar?.match(/BEGIN:VEVENT[\s\S]+?END:VEVENT/);
      if (match) additionalEvents.push(match[0]);
    }
    icsContent = icsContent.replace(
      "END:VCALENDAR",
      `${additionalEvents.join("\r\n")}\r\nEND:VCALENDAR`,
    );
  }

  return new Response(icsContent, {
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
