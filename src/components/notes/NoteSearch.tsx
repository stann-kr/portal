import Link from "next/link";
import { defaultTreeAdapter, parseFragment } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PrivateNoteListItem } from "./PrivateNoteList";

const MAX_QUERY_LENGTH = 120;
const NON_TEXT_TAGS = new Set(["script", "style", "template", "iframe", "noscript"]);
const BLOCK_TAGS = new Set(["p", "div", "br", "hr", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "tr", "td", "th"]);

export function getNoteSearchQuery(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : "").trim().slice(0, MAX_QUERY_LENGTH).replace(/[\uD800-\uDFFF]/gu, "");
}

/** 저장된 HTML 전체에서 본문만 추출한다. 속성·숨겨진 코드와 짧은 목록 preview는 검색하지 않는다. */
function noteText(contentHtml: string): string {
  const parts: string[] = [];
  const stack: (DefaultTreeAdapterTypes.ChildNode | string)[] = [...parseFragment(contentHtml).childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") {
      parts.push(node);
    } else if (defaultTreeAdapter.isTextNode(node)) {
      parts.push(node.value);
    } else if (defaultTreeAdapter.isElementNode(node) && !NON_TEXT_TAGS.has(node.tagName)) {
      if (BLOCK_TAGS.has(node.tagName)) {
        parts.push(" ");
        stack.push(" ");
      }
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push(node.childNodes[index]);
    }
  }
  return parts.join("").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function searchPrivateNotes<T extends PrivateNoteListItem>(notes: T[], query: string): (T & { searchPreview?: string })[] {
  const words = query.normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length) return notes;
  return notes.flatMap((note) => {
    const body = noteText(note.contentHtml);
    const lowerBody = body.toLowerCase();
    const searchText = `${note.title.normalize("NFKC").toLowerCase()} ${lowerBody}`;
    if (!words.every((word) => searchText.includes(word))) return [];
    const firstMatch = words.map((word) => lowerBody.indexOf(word)).find((index) => index >= 0) ?? 0;
    let matchStart = firstMatch;
    // İ처럼 소문자 변환으로 길이가 달라지는 문자는 원문 위치로 되돌린다.
    if (lowerBody.length !== body.length) {
      matchStart = 0;
      let foldedOffset = 0;
      for (const character of body) {
        const nextOffset = foldedOffset + character.toLowerCase().length;
        if (nextOffset > firstMatch) break;
        foldedOffset = nextOffset;
        matchStart += character.length;
      }
    }
    let start = Math.max(0, matchStart - 40);
    if (start > 0 && /[\uDC00-\uDFFF]/u.test(body[start])) start--;
    const excerpt = Array.from(body.slice(start, start + 320)).slice(0, 160).join("");
    return [{ ...note, searchPreview: body ? `${start ? "…" : ""}${excerpt}${start + excerpt.length < body.length ? "…" : ""}` : undefined }];
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
          <Input id="note-search" name="q" type="search" defaultValue={query} maxLength={MAX_QUERY_LENGTH} placeholder="기억나는 제목이나 내용을 입력하세요" aria-describedby="note-search-scope" className="min-w-0 flex-1 basis-48" />
          <Button type="submit" variant="outline">검색</Button>
          {query && <Link href={action} className="text-sm text-muted-foreground underline underline-offset-4">검색 초기화</Link>}
        </div>
        <p id="note-search-scope" className="text-xs text-muted-foreground">전체 기간의 노트를 검색합니다. 띄어 쓴 단어를 모두 포함한 기록을 찾습니다.</p>
      </form>
      <p role="status" className="text-sm text-muted-foreground">{query ? `전체 ${totalCount}개 중 ${resultCount}개` : `전체 ${totalCount}개`}</p>
    </section>
  );
}
