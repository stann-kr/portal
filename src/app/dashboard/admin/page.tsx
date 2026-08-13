/**
 * @file src/app/dashboard/admin/page.tsx
 * @description 관리자 원페이지 포털. RSC 데이터 프리패치 셸.
 * AdminPortalClient에 병렬 패치한 데이터를 props로 전달.
 */
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getPostsByBoardType } from "@/lib/actions/posts";
import { getStudentRosterStats } from "@/lib/actions/students";
import { getUnifiedItemsForStudent } from "@/lib/actions/unifiedItems";
import { getQnaThreads } from "@/lib/actions/qna";
import { getPendingFeedbackAssignments } from "@/lib/actions/assignments";
import { AdminPortalClient } from "@/components/admin-portal/AdminPortalClient";

export default async function AdminPortalPage() {
  const session = await getActiveAuthSession();
  if (session?.user?.role !== "admin") redirect("/dashboard/student");

  const adminId = session.user.id!;

  // 학생 목록 먼저 패치
  const students = await getStudentRosterStats();
  const firstStudentId = students[0]?.id ?? "";

  // 병렬 데이터 패치
  const referenceTime = new Date();
  const [announcements, communityPostsRaw, firstStudentItems, qnaThreads, pendingAssignments] = await Promise.all([
    getPostsByBoardType("ANNOUNCEMENT"),
    Promise.all([
      getPostsByBoardType("GENERAL"),
      getPostsByBoardType("FEEDBACK"),
    ]).then(([g, f]) =>
      [...g, ...f]
        .sort(
          (a, b) =>
            new Date(b.createdAt ?? 0).getTime() -
            new Date(a.createdAt ?? 0).getTime()
        )
        .slice(0, 20)
    ),
    firstStudentId ? getUnifiedItemsForStudent(firstStudentId) : Promise.resolve([]),
    getQnaThreads(),
    getPendingFeedbackAssignments(),
  ]);

  return (
    <AdminPortalClient
      announcements={announcements}
      initialUnifiedItems={firstStudentItems}
      students={students}
      communityPosts={communityPostsRaw}
      adminId={adminId}
      qnaThreads={qnaThreads}
      pendingAssignments={pendingAssignments}
      referenceTime={referenceTime}
    />
  );
}
