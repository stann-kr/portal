import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { PrivateNoteListItem } from "./PrivateNoteList";

import {
  DOCUMENT_SEARCH_MAX_QUERY_LENGTH,
  getDocumentSearchExcerpt,
  getDocumentSearchWords,
  getSearchableDocumentText,
} from "@/lib/document-search";
export { normalizeDocumentSearchQuery as getNoteSearchQuery } from "@/lib/document-search";

export function searchPrivateNotes<T extends PrivateNoteListItem>(notes: T[], query: string): (T & { searchPreview?: string })[] {
  const words = getDocumentSearchWords(query);
  if (!words.length) return notes;
  return notes.flatMap((note) => {
    const body = getSearchableDocumentText(note.contentHtml);
    const lowerBody = body.toLowerCase();
    const searchText = `${note.title.normalize("NFKC").toLowerCase()} ${lowerBody}`;
    if (!words.every((word) => searchText.includes(word))) return [];
    return [{ ...note, searchPreview: getDocumentSearchExcerpt(body, words) }];
  });
}

/**
 * database toolbar 안의 서버 검색. 제출(Enter)하면 `?q=`로 전체 기간의 제목·본문을 다시 찾는다.
 * 넓은 화면은 260px·32px, 좁은 화면은 전체 폭 44px 입력(Notes·MobileNotes 보드).
 */
export function NoteSearch({ action, query }: { action: string; query: string }) {
  return (
    <form key={query} action={action} method="get" role="search" aria-label="노트 검색" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 max-md:w-full">
      <label htmlFor="note-search" className="sr-only">제목·본문 검색</label>
      <div className="relative flex min-w-0 flex-1 items-center md:w-[260px] md:flex-none">
        <Search className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground md:left-2.5 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
        <Input
          id="note-search"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={DOCUMENT_SEARCH_MAX_QUERY_LENGTH}
          placeholder="제목·본문 검색"
          aria-describedby="note-search-scope"
          className="pl-10 pr-3.5 md:h-8 md:pl-8 md:pr-3 md:text-ui"
        />
      </div>
      {query ? (
        <Link href={action} className="shrink-0 whitespace-nowrap rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          검색 초기화
        </Link>
      ) : null}
    </form>
  );
}
