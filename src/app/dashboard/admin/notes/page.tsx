/**
 * 관리자 전체 노트 목록(개선 2차 시안 3번). 일정 머리줄의 "전체 노트 보기"가 이 화면으로 온다.
 * 모든 활성 학생의 노트를 최근 수정순으로 보이고, 학생 필터(`?student=`)와 제목·본문 검색(`?q=`)을 둔다.
 * 노트 작성은 학생 스페이스 문맥이 필요하므로 학생별 노트 화면·일정의 만들기가 맡는다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";
import { AllNotesTable, type AllNotesTableRow } from "@/components/notes/AllNotesTable";
import { getNoteSearchQuery, NoteSearch, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { NotesStudentFilter } from "@/components/notes/NotesStudentFilter";
import { NotesEmptyState } from "@/components/notes/PrivateNoteList";
import { getAllStudentNotes } from "@/lib/actions/all-notes";
import { ALL_NOTE_KIND_LABELS, ALL_NOTES_LIMIT } from "@/lib/all-notes-query";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { toNotesDatabaseRow } from "@/lib/notes-database";
import { getRequestNow } from "@/lib/request-time";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { firstSearchValue } from "@/lib/portal-location";

export const metadata = { title: "전체 노트" };

const LIST_PATH = "/dashboard/admin/notes";
const SCHEDULE_HREF = "/dashboard/admin?section=schedule&student=all";

export default async function AdminAllNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; student?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const params = await searchParams;
  const query = getNoteSearchQuery(params.q);
  const { students, selectedStudentId, notes, truncated } = await getAllStudentNotes({
    studentId: firstSearchValue(params.student),
    fullBody: query.length > 0,
  });
  const labels = new Map(students.map((student) => [student.id, getUnifiedItemSpaceLabel(student)]));
  const matching = searchPrivateNotes(notes, query);
  const rows: AllNotesTableRow[] = matching.map((note) => ({
    ...toNotesDatabaseRow(note),
    studentLabel: labels.get(note.studentId) ?? "학생",
    kindLabel: ALL_NOTE_KIND_LABELS[note.kind],
  }));

  const search = new URLSearchParams();
  if (selectedStudentId) search.set("student", selectedStudentId);
  const filterOnlyHref = search.size > 0 ? `${LIST_PATH}?${search.toString()}` : LIST_PATH;
  if (query) search.set("q", query);
  const returnTo = search.size > 0 ? `${LIST_PATH}?${search.toString()}` : LIST_PATH;
  const countLabel = query ? `${notes.length}개 중 ${rows.length}개` : `노트 ${notes.length}개`;
  const emptyMessage = query
    ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요."
    : students.length === 0
      ? "등록된 학생이 없습니다."
      : "아직 작성된 노트가 없습니다.";

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="전체 노트" back={{ href: SCHEDULE_HREF, label: "일정으로" }} />
      {/* 자동 저장은 목록을 revalidate하지 않으므로 편집에서 돌아오거나 창으로 돌아올 때 제목·날짜를 다시 받는다. */}
      <RouteAutoRefresh />
      <div className="flex max-w-[1080px] flex-col gap-5 md:mx-auto md:gap-6">
        <header className="flex flex-col gap-3 max-md:sr-only">
          <Link
            href={SCHEDULE_HREF}
            className="-ml-1 hidden h-8 items-center gap-1.5 self-start rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
          >
            <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />일정으로 돌아가기
          </Link>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="hidden text-xs text-muted-foreground md:block">전체 학생</p>
            <h1 className="sr-only text-display font-semibold tracking-display text-foreground md:not-sr-only">전체 노트</h1>
          </div>
        </header>

        <section aria-label="전체 노트" className="flex flex-col gap-1 md:gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3 md:border-b md:border-border md:pb-3">
            <NotesStudentFilter
              action={LIST_PATH}
              students={students.map((student) => ({ id: student.id, label: labels.get(student.id) ?? student.email }))}
              selectedStudentId={selectedStudentId}
              query={query}
            />
            <NoteSearch
              action={LIST_PATH}
              query={query}
              hiddenFields={selectedStudentId ? { student: selectedStudentId } : undefined}
              clearHref={filterOnlyHref}
            />
          </div>
          <div className="flex min-h-11 items-center md:min-h-0">
            <p className="text-ui text-muted-foreground md:text-xs">
              <span role="status">{countLabel}</span>{" "}
              <span id="note-search-scope" className="sr-only">전체 기간에서 띄어 쓴 단어를 모두 포함한 노트를 찾습니다.</span>
              {truncated ? <span> · 최근 수정한 {ALL_NOTES_LIMIT}개까지 보입니다. 학생을 골라 좁혀 보세요.</span> : null}
            </p>
          </div>
          {rows.length === 0 ? (
            <NotesEmptyState message={emptyMessage} />
          ) : (
            <AllNotesTable rows={rows} returnTo={returnTo} now={getRequestNow()} />
          )}
        </section>
      </div>
    </div>
  );
}
