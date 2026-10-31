/**
 * @file src/components/notes/LiveNoteArticle.tsx
 * @description 노트 문서 페이지의 읽기 전용 화면(다른 작성자의 노트 — 학생이 Stann의 수업 노트를 볼 때).
 * 서버가 넘긴 노트로 먼저 그리고, `useLiveNote`로 head를 폴링해 제목·날짜·수정 줄·본문만 제자리에서 바꾼다.
 * 휴지통 분기는 페이지가 서버에서 그대로 그린다.
 */
"use client";

import { CalendarDays, Clock3, LockKeyhole, UserRound } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import {
  NoteBreadcrumb,
  NoteDocumentBody,
  NoteDocumentStrip,
  NoteDocumentTitle,
  NoteHistoryLink,
  NoteProperties,
  NoteProperty,
  type NoteParent,
} from "@/components/notes/NoteDocumentChrome";
import { formatNoteLongDate, formatNoteUpdated } from "@/components/notes/note-display";
import { useLiveNote } from "@/lib/hooks/useLiveNote";

export type LiveNoteArticleNote = {
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  version: number;
};

export function LiveNoteArticle({
  note,
  authorName,
  now,
  parent,
  historyHref,
  pollDelay,
}: {
  note: LiveNoteArticleNote;
  authorName: string;
  /** 서버 렌더 기준 시각(ms). 첫 화면은 서버와 같은 글자를 내고, 갱신 뒤에는 갱신 시각을 기준으로 한다. */
  now: number;
  parent: NoteParent;
  historyHref: string;
  pollDelay?: number;
}) {
  const live = useLiveNote({
    noteId: note.id,
    initial: {
      version: note.version,
      title: note.title,
      contentHtml: note.contentHtml,
      noteDate: note.noteDate,
      updatedAt: note.updatedAt,
    },
    pollDelay,
  });
  const current = live.note;
  const referenceTime = live.refreshedAt ?? now;
  const updatedLabel = formatNoteUpdated(current.updatedAt ?? note.createdAt, referenceTime);

  return (
    <>
      <NoteDocumentStrip start={<NoteBreadcrumb parent={parent} current={current.title} />}>
        <NoteHistoryLink href={historyHref} />
      </NoteDocumentStrip>
      <NoteDocumentBody as="article">
        <NoteDocumentTitle>{current.title}</NoteDocumentTitle>
        <NoteProperties>
          <NoteProperty icon={CalendarDays} label="날짜">{formatNoteLongDate(current.noteDate ?? note.createdAt, "날짜 정보 없음")}</NoteProperty>
          <NoteProperty icon={UserRound} label="작성자">{authorName}</NoteProperty>
          <NoteProperty icon={Clock3} label="수정">{updatedLabel}</NoteProperty>
        </NoteProperties>

        {live.status === "missing" ? (
          <p role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            이 노트는 휴지통으로 옮겨졌거나 더 이상 볼 수 없습니다. 마지막으로 본 내용입니다.
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            다른 작성자의 노트는 읽기 전용입니다. 작성자가 저장하면 자동으로 갱신됩니다.
          </p>
        )}

        {/* 본문만 바꿔 스크롤·레이아웃이 튀지 않게 한다. 갱신 사실은 화면 밖 상태 줄로만 알린다. */}
        <p role="status" aria-live="polite" className="sr-only">
          {live.refreshedAt !== null ? "노트가 방금 갱신되었습니다." : ""}
        </p>
        <RichTextContent html={current.contentHtml} />
      </NoteDocumentBody>
    </>
  );
}
