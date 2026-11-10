/**
 * 관리자 전체 노트 목록(개선 2차 시안 3번). 일정 머리줄의 "전체 노트 보기"가 이 화면으로 온다.
 * 모든 활성 학생의 노트를 최근 수정순으로 50개씩 보이고, 학생 필터(`?student=`)·제목·본문 검색(`?q=`)·다음 페이지(`?cursor=`)를 둔다.
 * 검색·필터·페이지는 서버 SQL이 처리하고, 화면에는 표에 필요한 필드와 짧은 미리보기만 온다.
 * 노트 작성은 학생 스페이스 문맥이 필요하므로 학생별 노트 화면·일정의 만들기가 맡는다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";
import { AllNotesTable, type AllNotesTableRow } from "@/components/notes/AllNotesTable";
import { getNoteSearchQuery, NoteSearch } from "@/components/notes/NoteSearch";
import { NotesStudentFilter } from "@/components/notes/NotesStudentFilter";
import { NotesEmptyState } from "@/components/notes/PrivateNoteList";
import { getAllStudentNotes } from "@/lib/actions/all-notes";
import { ALL_NOTE_KIND_LABELS, ALL_NOTES_PAGE_SIZE } from "@/lib/all-notes-query";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { toNotesDatabaseRow } from "@/lib/notes-database";
import { getRequestNow } from "@/lib/request-time";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { firstSearchValue } from "@/lib/portal-location";

export const metadata = { title: "전체 노트" };

const LIST_PATH = "/dashboard/admin/notes";
const SCHEDULE_HREF = "/dashboard/admin?section=schedule&student=all";
const PAGE_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md px-2 text-ui text-secondary-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8";

export default async function AdminAllNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; student?: string | string[]; cursor?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const params = await searchParams;
  const query = getNoteSearchQuery(params.q);
  const { students, selectedStudentId, notes, continued, nextCursor } = await getAllStudentNotes({
    studentId: firstSearchValue(params.student),
    query,
    cursor: firstSearchValue(params.cursor),
  });
  const labels = new Map(students.map((student) => [student.id, getUnifiedItemSpaceLabel(student)]));
  const rows: AllNotesTableRow[] = notes.map((note) => ({
    // 서버가 이미 짧은 미리보기(검색이면 일치 주변)를 만들었으므로 본문 HTML 없이 행을 만든다.
    ...toNotesDatabaseRow({ ...note, contentHtml: "", searchPreview: note.preview }),
    studentLabel: labels.get(note.studentId) ?? "학생",
    kindLabel: ALL_NOTE_KIND_LABELS[note.kind],
  }));

  const search = new URLSearchParams();
  if (selectedStudentId) search.set("student", selectedStudentId);
  const filterOnlyHref = search.size > 0 ? `${LIST_PATH}?${search.toString()}` : LIST_PATH;
  if (query) search.set("q", query);
  const firstPageHref = search.size > 0 ? `${LIST_PATH}?${search.toString()}` : LIST_PATH;
  const pageSearch = (cursor: string) => {
    const next = new URLSearchParams(search);
    next.set("cursor", cursor);
    return `${LIST_PATH}?${next.toString()}`;
  };
  const currentCursor = continued ? firstSearchValue(params.cursor) : null;
  // 노트에서 돌아오면 같은 페이지로 온다.
  const returnTo = currentCursor ? pageSearch(currentCursor) : firstPageHref;
  const countLabel = `${continued ? "이어서 " : ""}${query ? "검색 결과" : "노트"} ${rows.length}개${nextCursor ? " · 더 있음" : ""}`;
  const emptyMessage = continued
    ? "이 뒤로는 노트가 없습니다."
    : query
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
            </p>
          </div>
          {rows.length === 0 ? (
            <NotesEmptyState message={emptyMessage} />
          ) : (
            <AllNotesTable rows={rows} returnTo={returnTo} now={getRequestNow()} />
          )}
          {continued || nextCursor ? (
            <nav aria-label="노트 페이지" className="flex items-center justify-between gap-3 pt-2">
              {continued ? (
                <Link href={firstPageHref} className={PAGE_LINK_CLASS}>처음부터 보기</Link>
              ) : <span />}
              {nextCursor ? (
                <Link href={pageSearch(nextCursor)} className={PAGE_LINK_CLASS}>다음 {ALL_NOTES_PAGE_SIZE}개 더 보기</Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
