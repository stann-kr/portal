"use server";

import { requireStudentTarget } from "@/lib/auth-guard";
import { issueCalendarFeedToken } from "@/lib/calendar-feed";
import {
  findCalendarFeedTokenIssuedAt,
  replaceCalendarFeedTokenDigest,
} from "@/lib/calendar-feed-store";

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

/** 관리자 학생 상세에서 기존 구독 URL 존재 여부와 마지막 발급 시각을 확인한다. */
export async function getStudentCalendarFeedIssuedAt(
  studentId: string,
): Promise<Date | null> {
  const student = await requireStudentTarget(studentId);
  return findCalendarFeedTokenIssuedAt(student.id);
}
