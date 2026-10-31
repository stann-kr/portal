/**
 * @file src/app/dashboard/student/page.tsx
 * @description 학생 원페이지 포탈 — RSC 데이터 프리패치 셸.
 * 모든 조회를 한 번에 병렬로 실행한 뒤 StudentPortalClient에 props 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getAnnouncementSummaries } from "@/lib/actions/posts";
import { getUnifiedItems } from "@/lib/actions/unifiedItems";
import { getMyCurriculum } from "@/lib/actions/curriculum";
import { isCurriculumVisible } from "@/lib/curriculum-visibility";
import { getMyAssignments } from "@/lib/actions/assignments";
import { getMyAssignmentTasks } from "@/lib/actions/assignmentTasks";
import { getMyFeedbacksMap } from "@/lib/actions/feedbacks";
import { toStudentAssignmentSummaries } from "@/lib/assignment-summary";
import { StudentPortalClient } from "@/components/student-portal/StudentPortalClient";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { getExternalCalendarConnectionSummary } from "@/lib/actions/externalCalendars";
import { legacyPortalSectionRedirect, resolvePortalLocation, type PortalSearchParams } from "@/lib/portal-location";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";

export const metadata = { title: "학생 포탈" };

export default async function StudentPortalPage({ searchParams }: { searchParams: Promise<PortalSearchParams> }) {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "student") redirect("/dashboard/admin");
  const params = await searchParams;
  const legacyRedirect = legacyPortalSectionRedirect(params);
  if (legacyRedirect) redirect(legacyRedirect);
  const initialLocation = resolvePortalLocation("student", params);

  const studentId = session.user.id!;
  const displayName = session.user.name ?? "";
  const spaceLabel = getUnifiedItemSpaceLabel({
    displayName: session.user.name ?? null,
    email: session.user.email ?? "학생",
  });

  // 정기 과제 회차를 먼저 만들어 오늘·캘린더(통합 항목)가 같은 회차를 보게 한다.
  const assignmentTasks = await getMyAssignmentTasks();

  // 병렬 데이터 패치. 게시물은 본문 없이 화면에 필요한 개수만 읽는다.
  const [announcements, unifiedItems, curriculumModules, rawAssignments, feedbacksMap, externalCalendarConnection] =
    await Promise.all([
      getAnnouncementSummaries(3),
      getUnifiedItems(),
      // 커리큘럼이 숨겨져 있으면 읽지 않는다(src/lib/curriculum-visibility.ts).
      isCurriculumVisible() ? getMyCurriculum() : Promise.resolve([]),
      getMyAssignments(),
      getMyFeedbacksMap(),
      getExternalCalendarConnectionSummary(),
    ]);

  // 과제 피드백 카운트 병합
  const assignmentList = toStudentAssignmentSummaries(rawAssignments, feedbacksMap);

  return (
    <>
      {/* Stann이 만든 새 노트·일정이 캘린더·목록에 새로고침 없이 나타나게 한다. 입력 중(패널 편집)에는 건너뛴다. */}
      <RouteAutoRefresh />
      <StudentPortalClient
        initialLocation={initialLocation}
        announcements={announcements}
        unifiedItems={unifiedItems}
        curriculumModules={curriculumModules.map((module) => ({
          ...module,
          description: null,
        }))}
        assignments={assignmentList}
        assignmentTasks={assignmentTasks}
        studentId={studentId}
        displayName={displayName}
        spaceLabel={spaceLabel}
        externalCalendarConnection={externalCalendarConnection}
        referenceTime={new Date()}
      />
    </>
  );
}
