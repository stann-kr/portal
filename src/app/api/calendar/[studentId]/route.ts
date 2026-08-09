/**
 * @file src/app/api/calendar/[studentId]/route.ts
 * @description 학생 전용 .ics 캘린더 피드 API.
 * 미래 레슨 일정을 .ics 파일로 다운로드 제공.
 */
import { NextRequest } from "next/server";
import { createDb } from "@/db/client";
import { findActiveProfileById } from "@/lib/active-profile";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { createCalendarFeedResponse } from "@/lib/calendar-feed-response";
import { findCalendarFeedTokenDigest } from "@/lib/calendar-feed-store";
import {
  canAccessCalendarFeed,
  verifyCalendarFeedToken,
} from "@/lib/calendar-feed";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await params;
  const token = req.nextUrl.searchParams.get("token");
  const db = createDb();
  const student = await findActiveProfileById(studentId, db);
  if (!student || student.role !== "student") {
    return new Response("Student not found", { status: 404 });
  }

  const session = await getActiveAuthSession();
  let canAccessViaToken = false;
  try {
    canAccessViaToken = await verifyCalendarFeedToken(
      studentId,
      token,
      (ownerId) => findCalendarFeedTokenDigest(ownerId, db),
    );
  } catch {
    // legacy AUTH_SECRET misconfiguration and DB lookup failures fail closed.
  }

  if (
    !canAccessCalendarFeed(
      student,
      session
        ? { id: session.user.id, role: session.user.role }
        : null,
      canAccessViaToken,
    )
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  return createCalendarFeedResponse(student, db);
}
