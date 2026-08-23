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
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { getQnaThreadsByStudent } from "@/lib/actions/qna";
import { getQnaThreads } from "@/lib/actions/qna";
import { getCurriculumByStudent } from "@/lib/actions/curriculum";
import { getPendingFeedbackAssignments } from "@/lib/actions/assignments";
import { AdminPortalClient } from "@/components/admin-portal/AdminPortalClient";
type RawNote = Awaited<ReturnType<typeof getPrivateNotes>>[number];
type RawQnaThread = Awaited<ReturnType<typeof getQnaThreadsByStudent>>[number];
type RawModule = Awaited<ReturnType<typeof getCurriculumByStudent>>[number];

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

  // 학생 상세 데이터 패치 함수 (클라이언트에서 호출)
  async function fetchStudentDetail(studentId: string) {
    "use server";
    const [notes, threads, modules] = await Promise.all([
      getPrivateNotes(studentId),
      getQnaThreadsByStudent(studentId),
      getCurriculumByStudent(studentId),
    ]);

    return {
      notes: notes.map((n: RawNote) => ({
        id: n.id,
        title: n.title,
        contentHtml: n.contentHtml,
        createdAt: n.createdAt ? new Date(n.createdAt) : null,
        authorId: n.authorId ?? null,
        authorName: n.authorName ?? null,
      })),
      threads: threads.map((t: RawQnaThread) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt ? new Date(t.createdAt) : null,
      })),
      modules: modules.map((m: RawModule) => ({
        id: m.id,
        weekNum: m.weekNum ?? null,
        title: m.title,
        isCompleted: m.isCompleted ?? null,
      })),
    };
  }

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
      fetchStudentDetail={fetchStudentDetail}
    />
  );
}
