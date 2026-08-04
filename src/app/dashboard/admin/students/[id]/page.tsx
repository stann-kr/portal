/**
 * @file src/app/dashboard/admin/students/[id]/page.tsx
 * @description 학생 상세 페이지 (Admin 전용) — RSC 탭 통합 뷰.
 * URL searchParams(?tab=xxx)로 Overview / Digging / Notes / Q&A 전환.
 * 각 탭은 서버에서 데이터를 병렬 fetch하여 렌더링.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getStudentById } from "@/lib/actions/students";
import { getCurriculumByStudent } from "@/lib/actions/curriculum";
import { getLessonsByStudent } from "@/lib/actions/lessons";
import { getOrSeedColumns, getDiggingTracks } from "@/lib/actions/digging";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { getQnaThreadsByStudent } from "@/lib/actions/qna";
import { createCalendarFeedToken } from "@/lib/calendar-feed";
import { StudentDetailTabs } from "@/components/admin/StudentDetailTabs";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import { ThreadList } from "@/components/qna/ThreadList";
import { PrivateNoteForm } from "@/components/notes/PrivateNoteForm";
import { DeleteNoteButton } from "@/components/notes/DeleteNoteButton";
import { MessageSquarePlus } from "lucide-react";
import type { DiggingColumnType, QnaStatus } from "@/db/schema";

type TabKey = "overview" | "digging" | "notes" | "qna";
type RawColumn = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
type RawNote = Awaited<ReturnType<typeof getPrivateNotes>>[number];
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

async function NotesTabContent({
  studentId,
  adminId,
}: {
  studentId: string;
  adminId: string;
}) {
  const notes = await getPrivateNotes(studentId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {/* 노트 작성 */}
      <div className="md:col-span-1">
        <div className="p-6 rounded-xl border border-border bg-card shadow-sm sticky top-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <MessageSquarePlus className="w-5 h-5 text-muted-foreground" />
            노트 작성
          </h2>
          <PrivateNoteForm studentId={studentId} />
        </div>
      </div>

      {/* 노트 목록 */}
      <div className="md:col-span-2 space-y-4">
        <h2 className="text-lg font-semibold">노트 기록 ({notes.length})</h2>
        {notes.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground border border-dashed rounded-xl bg-muted/10">
            <p className="text-sm">아직 작성된 1:1 노트가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.map((note: RawNote) => (
              <div
                key={note.id}
                className="p-5 rounded-xl border border-border bg-card shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {note.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{note.authorName || "작성자 미상"}</span>
                      <span>·</span>
                      <span>
                        {new Date(note.createdAt!).toLocaleString("ko-KR", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  {note.authorId === adminId && (
                    <DeleteNoteButton noteId={note.id} />
                  )}
                </div>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: note.contentHtml }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function QnaTabContent({ studentId }: { studentId: string }) {
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

  return <ThreadList threads={threads} isAdmin={true} />;
}

// ─── 메인 페이지 (RSC) ────────────────────────────

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") redirect("/login");

  const { id: studentId } = await params;
  const { tab = "overview" } = await searchParams;
  const activeTab = tab as TabKey;

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {student.displayName ?? student.email}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{student.email}</p>
      </div>

      {/* 탭 네비게이션 */}
      <StudentDetailTabs studentId={studentId} />

      {/* 탭 콘텐츠 */}
      <div className="pt-2">
        {activeTab === "overview" && (
          <OverviewTab
            studentId={studentId}
            icsUrl={`/api/calendar/${studentId}?token=${encodeURIComponent(createCalendarFeedToken(studentId))}`}
            student={student}
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
            <NotesTabContent
              studentId={studentId}
              adminId={session.user.id!}
            />
          </Suspense>
        )}

        {activeTab === "qna" && (
          <Suspense
            fallback={
              <div className="h-40 rounded-xl border bg-card animate-pulse" />
            }
          >
            <QnaTabContent studentId={studentId} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
