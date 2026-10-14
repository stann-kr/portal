/**
 * @file src/app/dashboard/student/page.tsx
 * @description 학생 원페이지 포털 — RSC 데이터 프리패치 셸.
 * 모든 조회를 한 번에 병렬로 실행한 뒤 StudentPortalClient에 props 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getAnnouncementSummaries, getRecentCommunityPostSummaries } from "@/lib/actions/posts";
import { getUnifiedItems } from "@/lib/actions/unifiedItems";
import { getMyCurriculum } from "@/lib/actions/curriculum";
import { getMyAssignments } from "@/lib/actions/assignments";
import { getMyFeedbacksMap } from "@/lib/actions/feedbacks";
import type { InferSelectModel } from "drizzle-orm";
import { assignments } from "@/db/schema";
import { StudentPortalClient } from "@/components/student-portal/StudentPortalClient";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { getExternalCalendarConnectionSummary } from "@/lib/actions/externalCalendars";
import { resolvePortalLocation, type PortalSearchParams } from "@/lib/portal-location";

export const metadata = { title: "학생 포털" };

export default async function StudentPortalPage({ searchParams }: { searchParams: Promise<PortalSearchParams> }) {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "student") redirect("/dashboard/admin");
  const initialLocation = resolvePortalLocation("student", await searchParams);

  const studentId = session.user.id!;
  const displayName = session.user.name ?? "";
  const spaceLabel = getUnifiedItemSpaceLabel({
    displayName: session.user.name ?? null,
    email: session.user.email ?? "학생",
  });

  // 병렬 데이터 패치. 게시물은 본문 없이 화면에 필요한 개수만 읽는다.
  const [announcements, communityPosts, unifiedItems, curriculumModules, rawAssignments, feedbacksMap, externalCalendarConnection] =
    await Promise.all([
      getAnnouncementSummaries(3),
      getRecentCommunityPostSummaries(20),
      getUnifiedItems(),
      getMyCurriculum(),
      getMyAssignments(),
      getMyFeedbacksMap(),
      getExternalCalendarConnectionSummary(),
    ]);

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
      initialLocation={initialLocation}
      announcements={announcements}
      unifiedItems={unifiedItems}
      curriculumModules={curriculumModules.map((module) => ({
        ...module,
        description: null,
      }))}
      assignments={assignmentList}
      communityPosts={communityPosts}
      studentId={studentId}
      displayName={displayName}
      spaceLabel={spaceLabel}
      externalCalendarConnection={externalCalendarConnection}
      referenceTime={new Date()}
    />
  );
}
