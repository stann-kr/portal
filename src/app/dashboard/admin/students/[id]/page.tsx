/**
 * @file src/app/dashboard/admin/students/[id]/page.tsx
 * @description 학생 상세 페이지 (Admin 전용) — RSC 탭 통합 뷰.
 * URL searchParams(?tab=xxx)로 Overview / Digging / Notes / Q&A 전환.
 * 각 탭은 서버에서 데이터를 병렬 fetch하여 렌더링.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentById } from "@/lib/actions/students";
import { getCurriculumByStudent } from "@/lib/actions/curriculum";
import { getLessonsByStudent } from "@/lib/actions/lessons";
import { getOrSeedColumns, getDiggingTracks } from "@/lib/actions/digging";
import { getQnaThreadsByStudent } from "@/lib/actions/qna";
import { StudentDetailTabs } from "@/components/admin/StudentDetailTabs";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import { ThreadList } from "@/components/qna/ThreadList";
import { resolveQnaFilter } from "@/lib/qna-routes";
import { BookOpen } from "lucide-react";
import Link from "next/link";
import type { DiggingColumnType, QnaStatus } from "@/db/schema";
import { ArrowLeft } from "lucide-react";
import {
  buildAdminStudentDetailHref,
  resolveStudentDetailTab,
  type StudentDetailTab,
} from "@/lib/student-space-routes";

type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
type RawQnaThread = Awaited<ReturnType<typeof getQnaThreadsByStudent>>[number];

// ─── 탭별 콘텐츠 ───────────────────────────────────

async function DiggingTabContent({ studentId }: { studentId: string }) {
  const [columns, tracks] = await Promise.all([
    getOrSeedColumns(studentId),
    getDiggingTracks(studentId),
  ]);

  return (
    <DiggingBoard
      initialColumns={columns.map((c: RawColumn) => ({
        id: c.id,
        name: c.name,
        columnType: c.columnType as DiggingColumnType,
        options: c.options,
        isDefault: c.isDefault ?? false,
        sortOrder: c.sortOrder ?? 0,
      }))}
      initialTracks={tracks}
      readonly
    />
  );
}

function NotesTabContent({ studentId }: { studentId: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <BookOpen className="size-5 text-primary" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold">노트는 별도 목록에서 관리합니다</h2>
      <p className="mt-1 text-sm text-muted-foreground">작성과 탐색을 분리해 학생 스페이스와 기록 문맥을 넓게 확인할 수 있습니다.</p>
      <Link href={`/dashboard/admin/students/${studentId}/notes`} className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">학생 노트 목록 열기</Link>
    </section>
  );
}

async function QnaTabContent({ studentId, filter }: { studentId: string; filter: ReturnType<typeof resolveQnaFilter> }) {
  const rawThreads = await getQnaThreadsByStudent(studentId);
  const threads = rawThreads.map((t: RawQnaThread) => ({
    ...t,
    status: t.status as QnaStatus,
  }));

  if (threads.length === 0) {
    return (
      <div className="p-12 text-center text-muted-foreground border border-dashed rounded-xl bg-muted/10">
        <p className="text-sm">아직 작성된 Q&A 스레드가 없습니다.</p>
      </div>
    );
  }

  return (
    <ThreadList
      threads={threads}
      isAdmin={true}
      returnTo={`/dashboard/admin/students/${studentId}?tab=qna`}
      filter={filter}
    />
  );
}

// ─── 메인 페이지 (RSC) ────────────────────────────

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; qnaStatus?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user || session.user.role !== "admin") redirect("/login");

  const { id: studentId } = await params;
  const { tab = "overview", qnaStatus } = await searchParams;
  const activeTab: StudentDetailTab = resolveStudentDetailTab(tab);
  if (tab !== activeTab) redirect(buildAdminStudentDetailHref(studentId, activeTab));

  const student = await getStudentById(studentId);
  if (!student) redirect("/dashboard/admin");

  // Overview 탭 데이터는 미리 병렬 fetch
  const [modules, lessons] = await (activeTab === "overview"
    ? Promise.all([
        getCurriculumByStudent(studentId),
        getLessonsByStudent(studentId),
      ])
    : Promise.resolve([[], []] as [
        Awaited<ReturnType<typeof getCurriculumByStudent>>,
        Awaited<ReturnType<typeof getLessonsByStudent>>,
      ]));

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6">
      {/* 학생 헤더 */}
      <div className="space-y-1">
        <Link href="/dashboard/admin?section=students" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />학생 목록으로 돌아가기
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {student.displayName ?? student.email}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{student.email}</p>
      </div>

      {/* 탭 네비게이션 */}
      <StudentDetailTabs studentId={studentId} activeTab={activeTab} />

      {/* 탭 콘텐츠 */}
      <div className="pt-2">
        {activeTab === "overview" && (
          <OverviewTab
            studentId={studentId}
            modules={modules}
            lessons={lessons}
          />
        )}

        {activeTab === "digging" && (
          <Suspense
            fallback={
              <div className="h-64 rounded-xl border bg-card animate-pulse" />
            }
          >
            <DiggingTabContent studentId={studentId} />
          </Suspense>
        )}

        {activeTab === "notes" && (
          <Suspense
            fallback={
              <div className="h-64 rounded-xl border bg-card animate-pulse" />
            }
          >
            <NotesTabContent studentId={studentId} />
          </Suspense>
        )}

        {activeTab === "qna" && (
          <Suspense
            fallback={
              <div className="h-40 rounded-xl border bg-card animate-pulse" />
            }
          >
            <QnaTabContent studentId={studentId} filter={resolveQnaFilter(qnaStatus)} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
