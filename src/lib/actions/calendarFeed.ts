"use server";

import { requireStudentTarget } from "@/lib/auth-guard";
import { issueCalendarFeedToken } from "@/lib/calendar-feed";
import { replaceCalendarFeedTokenDigest } from "@/lib/calendar-feed-store";

export async function issueStudentCalendarFeedUrl(
  studentId: string,
): Promise<string> {
  const student = await requireStudentTarget(studentId);

  const token = await issueCalendarFeedToken(
    student.id,
    replaceCalendarFeedTokenDigest,
  );
  return `/api/calendar/feed?token=${encodeURIComponent(token)}`;
}
