/**
 * @file src/app/dashboard/student/page.tsx
 * @description 학생 원페이지 포털 — RSC 데이터 프리패치 셸.
 * 5개 병렬 쿼리 후 StudentPortalClient에 props 전달. Waterfall 없음.
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPostsByBoardType } from "@/lib/actions/posts";
import { getUnifiedItems } from "@/lib/actions/unifiedItems";
import { getMyCurriculum } from "@/lib/actions/curriculum";
import { getMyAssignments } from "@/lib/actions/assignments";
import { getMyFeedbacksMap } from "@/lib/actions/feedbacks";
import type { InferSelectModel } from "drizzle-orm";
import { assignments } from "@/db/schema";
import { StudentPortalClient } from "@/components/student-portal/StudentPortalClient";

export default async function StudentPortalPage() {
  const session = await auth();
  if (session?.user?.role !== "student") redirect("/dashboard/admin");

  const studentId = session.user.id!;
  const displayName = session.user.name ?? "";

  // 병렬 데이터 패치
  const [announcements, unifiedItems, curriculumModules, rawAssignments, feedbacksMap] =
    await Promise.all([
      getPostsByBoardType("ANNOUNCEMENT"),
      getUnifiedItems(),
      getMyCurriculum(),
      getMyAssignments(),
      getMyFeedbacksMap(),
    ]);

  // 커뮤니티 게시물 — GENERAL + FEEDBACK 통합 (최근 20개)
  const [generalPosts, feedbackPosts] = await Promise.all([
    getPostsByBoardType("GENERAL"),
    getPostsByBoardType("FEEDBACK"),
  ]);
  const communityPosts = [...generalPosts, ...feedbackPosts]
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() -
        new Date(a.createdAt ?? 0).getTime(),
    )
    .slice(0, 20);

  // 과제 피드백 카운트 병합
  type RawAssignment = InferSelectModel<typeof assignments>;
  const assignmentList = (rawAssignments as RawAssignment[]).map((a) => ({
    id: a.id,
    mediaUrl: a.mediaUrl,
    submittedAt: a.submittedAt,
    feedbackCount: feedbacksMap[a.id] ?? 0,
  }));

  return (
    <StudentPortalClient
      announcements={announcements}
      unifiedItems={unifiedItems}
      curriculumModules={curriculumModules}
      assignments={assignmentList}
      communityPosts={communityPosts}
      studentId={studentId}
      displayName={displayName}
      referenceTime={new Date()}
    />
  );
}
