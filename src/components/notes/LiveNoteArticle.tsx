/**
 * @file src/components/notes/LiveNoteArticle.tsx
 * @description 노트 문서 페이지의 읽기 전용 화면(다른 작성자의 노트 — 학생이 Stann의 수업 노트를 볼 때).
 * 서버가 넘긴 노트로 먼저 그리고, 같은 공동 편집 room에 읽기 전용으로 붙어 작성자의 입력과 커서를 실시간으로 보여 준다.
 * 휴지통 분기는 페이지가 서버에서 그대로 그린다.
 */
"use client";

import { useRef } from "react";
import { CalendarDays, Clock3, LockKeyhole, UserRound } from "lucide-react";
import { RecordingDock } from "@/components/lesson/RecordingDock";
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
import { useLiveCollabNote } from "./useLiveCollabNote";

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
}: {
  note: LiveNoteArticleNote;
  authorName: string;
  /** 서버 렌더 기준 시각(ms). 첫 화면은 서버와 같은 글자를 내고, 갱신 뒤에는 갱신 시각을 기준으로 한다. */
  now: number;
  parent: NoteParent;
  historyHref: string;
}) {
  const live = useLiveCollabNote(note);
  const contentRef = useRef<HTMLDivElement>(null);
  const updatedLabel = live.changedAt !== null
    ? formatNoteUpdated(new Date(live.changedAt), live.changedAt)
    : formatNoteUpdated(note.updatedAt ?? note.createdAt, now);
  const noteDate = live.noteDate ? new Date(`${live.noteDate}T00:00:00.000Z`) : note.noteDate;

  return (
    <>
      <NoteDocumentStrip start={<NoteBreadcrumb parent={parent} current={live.title} />}>
        <NoteHistoryLink href={historyHref} />
      </NoteDocumentStrip>
      <div ref={contentRef}>
        <NoteDocumentBody as="article">
          <NoteDocumentTitle>{live.title}</NoteDocumentTitle>
          <NoteProperties>
            <NoteProperty icon={CalendarDays} label="날짜">{formatNoteLongDate(noteDate ?? note.createdAt, "날짜 정보 없음")}</NoteProperty>
            <NoteProperty icon={UserRound} label="작성자">{authorName}</NoteProperty>
            <NoteProperty icon={Clock3} label="수정">{updatedLabel}</NoteProperty>
          </NoteProperties>

          {live.missing ? (
            <p role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyhole className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              이 노트는 휴지통으로 옮겨졌거나 더 이상 볼 수 없습니다. 마지막으로 본 내용입니다.
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyhole className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              다른 작성자의 노트는 읽기 전용입니다. 작성자가 쓰는 내용이 실시간으로 보입니다.
            </p>
          )}

          {/* 본문만 바꿔 스크롤·레이아웃이 튀지 않게 한다. 갱신 사실은 화면 밖 상태 줄로만 알린다. */}
          <p role="status" aria-live="polite" className="sr-only">
            {live.changedAt !== null ? "노트가 방금 갱신되었습니다." : ""}
          </p>
          {live.body}
        </NoteDocumentBody>
      </div>
      {/* 본문의 녹음 링크와 [시점]으로 수업 녹음을 다시 듣는다. 재생 칸은 찾는 범위(contentRef) 밖에 둔다. */}
      <RecordingDock rootRef={contentRef} />
    </>
  );
}
