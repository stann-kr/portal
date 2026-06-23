/**
 * @file src/app/dashboard/admin/page.tsx
 * @description 관리자 원페이지 포털 — RSC 데이터 프리패치 셸.
 * AdminPortalClient에 병렬 패치한 데이터를 props로 전달.
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPostsByBoardType } from "@/lib/actions/posts";
import { getStudentRosterStats } from "@/lib/actions/students";
import { getUnifiedItemsForStudent } from "@/lib/actions/unifiedItems";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { getQnaThreadsByStudent } from "@/lib/actions/qna";
import { getCurriculumByStudent } from "@/lib/actions/curriculum";
import { AdminPortalClient } from "@/components/admin-portal/AdminPortalClient";
type RawNote = Awaited<ReturnType<typeof getPrivateNotes>>[number];
type RawQnaThread = Awaited<ReturnType<typeof getQnaThreadsByStudent>>[number];
type RawModule = Awaited<ReturnType<typeof getCurriculumByStudent>>[number];

export default async function AdminPortalPage() {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/dashboard/student");

  const adminId = session.user.id!;

  // 학생 목록 먼저 패치
  const students = await getStudentRosterStats();
  const firstStudentId = students[0]?.id ?? "";

  // 병렬 데이터 패치
  const [announcements, communityPostsRaw, firstStudentItems] = await Promise.all([
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
  ]);

  // 통계 카드 데이터
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingThisWeek = students.filter(
    (s) => s.nextLessonDate && s.nextLessonDate >= now && s.nextLessonDate <= weekLater
  ).length;
  const totalPending = students.reduce((sum, s) => sum + s.pendingFeedbackCount, 0);

  const stats = [
    {
      label: "Active Students",
      value: students.length,
      sub: "등록된 수강생",
      color: "text-blue-500 bg-blue-500/10",
    },
    {
      label: "Lessons This Week",
      value: upcomingThisWeek,
      sub: "7일 이내 예정",
      color: "text-green-500 bg-green-500/10",
    },
    {
      label: "Pending Feedbacks",
      value: totalPending,
      sub: totalPending > 0 ? "처리 대기 중" : "모두 처리됨",
      color: totalPending > 0 ? "text-red-500 bg-red-500/10" : "text-muted-foreground bg-muted",
    },
  ];

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
      stats={stats}
      adminId={adminId}
      fetchStudentDetail={fetchStudentDetail}
    />
  );
}
