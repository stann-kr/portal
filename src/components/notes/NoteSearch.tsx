import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

/** database toolbar 안의 서버 검색. 제출하면 `?q=`로 전체 기간의 제목·본문을 다시 찾는다. */
export function NoteSearch({ action, query }: { action: string; query: string }) {
  return (
    <form key={query} action={action} method="get" role="search" aria-label="노트 검색" className="flex min-w-0 flex-1 basis-56 items-center gap-1.5">
      <label htmlFor="note-search" className="sr-only">제목·본문 검색</label>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input id="note-search" name="q" type="search" defaultValue={query} maxLength={DOCUMENT_SEARCH_MAX_QUERY_LENGTH} placeholder="제목·본문 검색" aria-describedby="note-search-scope" className="h-8 pl-8" />
      </div>
      <Button type="submit" variant="ghost" size="sm" className="h-8 shrink-0 px-2.5">검색</Button>
      {query && <Link href={action} className="shrink-0 whitespace-nowrap text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">검색 초기화</Link>}
    </form>
  );
}
