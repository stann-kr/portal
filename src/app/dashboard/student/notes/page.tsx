/**
 * @file src/app/dashboard/student/notes/page.tsx
 * @description 학생 전용 노트 목록. 작성은 별도 full-page composer로 이동한다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Clock3, Plus, Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getPrivateNotes } from "@/lib/actions/privateNotes";
import { PrivateNoteList } from "@/components/notes/PrivateNoteList";
import { getNoteSearchQuery, NoteSearch, searchPrivateNotes } from "@/components/notes/NoteSearch";
import { buildNotesLessonsTimelineHref } from "@/lib/calendar-section-contract";

export const metadata = { title: "내 노트" };

export default async function StudentNotesPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "student") redirect("/dashboard/admin");

  const listPath = "/dashboard/student/notes";
  const query = getNoteSearchQuery((await searchParams).q);
  const returnTo = query ? `${listPath}?q=${encodeURIComponent(query)}` : listPath;
  const notes = await getPrivateNotes(session.user.id);
  const matchingNotes = searchPrivateNotes(notes, query);
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-sm text-muted-foreground">내 스페이스</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><BookOpen className="size-6 text-primary" aria-hidden="true" />노트</h1>
          <p className="mt-1 text-sm text-muted-foreground">작성 기록을 확인하고 전체 화면에서 이어서 편집할 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={buildNotesLessonsTimelineHref({ role: "student" })} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Clock3 className="size-4" aria-hidden="true" />시간으로 보기</Link>
          <Link href={`/dashboard/notes/trash?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><Trash2 className="size-4" aria-hidden="true" />휴지통</Link>
          <Link href={`/dashboard/student/notes/new?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"><Plus className="size-4" aria-hidden="true" />노트 작성</Link>
        </div>
      </header>
      <NoteSearch action={listPath} query={query} totalCount={notes.length} resultCount={matchingNotes.length} />
      <PrivateNoteList notes={matchingNotes} returnTo={returnTo} emptyMessage={query ? "검색 결과가 없습니다. 다른 단어로 검색하거나 검색을 초기화해 주세요." : undefined} />
    </div>
  );
}
