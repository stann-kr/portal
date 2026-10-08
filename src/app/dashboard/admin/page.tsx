/**
 * @file src/app/dashboard/admin/page.tsx
 * @description 관리자 원페이지 포털. RSC 데이터 프리패치 셸.
 * AdminPortalClient에 병렬 패치한 데이터를 props로 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getPostsByBoardType, getRecentCommunityPostSummaries } from "@/lib/actions/posts";
import { getStudentRosterStats } from "@/lib/actions/students";
import { getUnifiedItemsForStudent } from "@/lib/actions/unifiedItems";
import { getQnaThreads } from "@/lib/actions/qna";
import { getPendingFeedbackAssignments } from "@/lib/actions/assignments";
import { AdminPortalClient } from "@/components/admin-portal/AdminPortalClient";
import { firstSearchValue, resolvePortalLocation, type PortalSearchParams } from "@/lib/portal-location";

export default async function AdminPortalPage({ searchParams }: { searchParams: Promise<PortalSearchParams> }) {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "admin") redirect("/dashboard/student");

  const adminId = session.user.id!;
  const params = await searchParams;
  const initialLocation = resolvePortalLocation("admin", params);

  // 학생 목록 먼저 패치
  const students = await getStudentRosterStats();
  const requestedStudentId = firstSearchValue(params.student);
  const initialStudentId = students.find((student) => student.id === requestedStudentId)?.id ?? students[0]?.id ?? "";

  // 병렬 데이터 패치
  const referenceTime = new Date();
  const [announcements, communityPostsRaw, initialStudentItems, qnaThreads, pendingAssignments] = await Promise.all([
    getPostsByBoardType("ANNOUNCEMENT"),
    getRecentCommunityPostSummaries(20),
    initialStudentId ? getUnifiedItemsForStudent(initialStudentId) : Promise.resolve([]),
    getQnaThreads(),
    getPendingFeedbackAssignments(),
  ]);

  return (
    <AdminPortalClient
      initialLocation={initialLocation}
      initialStudentId={initialStudentId}
      announcements={announcements}
      initialUnifiedItems={initialStudentItems}
      students={students}
      communityPosts={communityPostsRaw}
      adminId={adminId}
      qnaThreads={qnaThreads}
      pendingAssignments={pendingAssignments}
      referenceTime={referenceTime}
    />
  );
}
