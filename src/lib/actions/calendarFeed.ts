"use server";

import { findActiveProfileById } from "@/lib/active-profile";
import { requireAdmin } from "@/lib/auth-guard";
import { issueCalendarFeedToken } from "@/lib/calendar-feed";
import { replaceCalendarFeedTokenDigest } from "@/lib/calendar-feed-store";

export async function issueStudentCalendarFeedUrl(
  studentId: string,
): Promise<string> {
  await requireAdmin();
  const student = await findActiveProfileById(studentId);
  if (!student || student.role !== "student") {
    throw new Error("Student not found");
  }

  const token = await issueCalendarFeedToken(
    student.id,
    replaceCalendarFeedTokenDigest,
  );
  return `/api/calendar/feed?token=${encodeURIComponent(token)}`;
}
