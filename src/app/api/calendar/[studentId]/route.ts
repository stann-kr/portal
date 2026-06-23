/**
 * @file src/app/api/calendar/[studentId]/route.ts
 * @description 학생 전용 .ics 캘린더 피드 API.
 * 미래 레슨 일정을 .ics 파일로 다운로드 제공.
 */
import { NextRequest } from "next/server";
import { createEvent, type EventAttributes } from "ics";
import { auth } from "@/auth";
import { createDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { getLessonsForCalendar } from "@/lib/actions/lessons";
import { verifyCalendarFeedToken } from "@/lib/calendar-feed";
import { eq } from "drizzle-orm";

type Lesson = Awaited<ReturnType<typeof getLessonsForCalendar>>[number];




export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await params;
  const token = req.nextUrl.searchParams.get("token");
  const session = await auth();
  const canAccessViaSession =
    !!session?.user?.id &&
    (session.user.role === "admin" || session.user.id === studentId);
  const canAccessViaToken = verifyCalendarFeedToken(studentId, token);

  if (!canAccessViaSession && !canAccessViaToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createDb();
  const studentRows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      displayName: profiles.displayName,
      role: profiles.role,
    })
    .from(profiles)
    .where(eq(profiles.id, studentId))
    .limit(1);

  const student = studentRows[0];
  if (!student) {
    return new Response("Student not found", { status: 404 });
  }
  if (student.role !== "student") {
    return new Response("Student not found", { status: 404 });
  }

  // 레슨 목록 조회
  const lessonList = await getLessonsForCalendar(studentId);

  // ICS 이벤트 생성
  const events: EventAttributes[] = lessonList
    .filter((l: Lesson) => l.scheduledAt !== null)
    .map((l: Lesson) => {
      const d = new Date(l.scheduledAt!);
      return {
        start: [
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          d.getHours(),
          d.getMinutes(),
        ] as [number, number, number, number, number],
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

  // 여러 이벤트가 있을 때는 직접 조합
  let icsContent = value;
  if (events.length > 1) {
    const lines: string[] = [];
    for (const event of events.slice(1)) {
      const { value: ev } = createEvent(event);
      if (ev) {
        // BEGIN:VCALENDAR ~ END:VCALENDAR 사이의 VEVENT만 추출
        const match = ev.match(/BEGIN:VEVENT[\s\S]+?END:VEVENT/);
        if (match) lines.push(match[0]);
      }
    }
    icsContent = icsContent.replace(
      "END:VCALENDAR",
      lines.join("\r\n") + "\r\nEND:VCALENDAR",
    );
  }

  return new Response(icsContent, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="stannlumo-lessons-${studentId.slice(0, 8)}.ics"`,
      "Cache-Control": "no-cache",
    },
  });
}
