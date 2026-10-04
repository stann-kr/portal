import Link from "next/link";
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

export function NoteSearch({ action, query, totalCount, resultCount }: {
  action: string;
  query: string;
  totalCount: number;
  resultCount: number;
}) {
  return (
    <section className="space-y-2" aria-label="노트 검색">
      <form key={query} action={action} method="get" role="search" className="space-y-2">
        <label htmlFor="note-search" className="text-sm font-medium">제목·본문 검색</label>
        <div className="flex flex-wrap items-center gap-2">
          <Input id="note-search" name="q" type="search" defaultValue={query} maxLength={DOCUMENT_SEARCH_MAX_QUERY_LENGTH} placeholder="기억나는 제목이나 내용을 입력하세요" aria-describedby="note-search-scope" className="min-w-0 flex-1 basis-48" />
          <Button type="submit" variant="outline">검색</Button>
          {query && <Link href={action} className="text-sm text-muted-foreground underline underline-offset-4">검색 초기화</Link>}
        </div>
        <p id="note-search-scope" className="text-xs text-muted-foreground">전체 기간의 노트를 검색합니다. 띄어 쓴 단어를 모두 포함한 기록을 찾습니다.</p>
      </form>
      <p role="status" className="text-sm text-muted-foreground">{query ? `전체 ${totalCount}개 중 ${resultCount}개` : `전체 ${totalCount}개`}</p>
    </section>
  );
}
