/**
 * @file src/components/student-portal/UnifiedNoteDetail.tsx
 * @description 상세 패널의 노트(캔버스 Calendar 보드 노트 패널): 머리 왼쪽 저장 상태(편집할 때, 아니면 유형),
 * 머리 오른쪽 전체 화면 열기, 24/32 제목, 88px 이름 칸의 날짜·작성자·수정 줄, 구분선, 본문.
 */
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { LockKeyhole, Maximize2 } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { NoteEditorForm, type SavedNote } from "@/components/notes/NoteEditorForm";
import { Button } from "@/components/ui/button";
import { getPrivateNote, updatePrivateNote, type UpdateNoteState } from "@/lib/actions/privateNotes";
import { createNotePreview } from "@/lib/unified-item-normalization";
import { toKstDateInputValue } from "@/lib/date-input";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { formatDetailDate } from "@/components/calendar/calendar-dates";
import { formatNoteUpdated } from "@/components/notes/note-display";
import { UnifiedItemTypeBadge } from "@/components/ui/unified-item-type";
import { useSlidePanelHeaderSlots } from "./SlidePanel";

type LoadedNote = NonNullable<Awaited<ReturnType<typeof getPrivateNote>>>;

type NoteBodyState =
  | { status: "loading" }
  | { status: "ready"; note: LoadedNote; loadedAt: number }
  | { status: "missing" }
  | { status: "error" };

export type NoteDetailViewer = { actorId: string; role: "admin" | "student" };

/** 패널에서 저장한 값을 캘린더·목록 항목에 반영한다. 날짜를 비우면 작성일로 돌아간다. */
function applySavedNote(item: UnifiedItem, saved: SavedNote, createdAt: Date): UnifiedItem {
  return {
    ...item,
    title: saved.title,
    date: saved.noteDate ? new Date(saved.noteDate) : new Date(createdAt),
    metadata: {
      ...item.metadata,
      noteDate: saved.noteDate,
      preview: createNotePreview(saved.contentHtml),
    },
  };
}

/** 지정 날짜는 UTC 자정으로 저장되므로 그 날짜 그대로, 없으면 작성일의 KST 날짜. */
function noteDateKey(note: LoadedNote): string {
  return note.noteDate ? new Date(note.noteDate).toISOString().slice(0, 10) : toKstDateInputValue(new Date(note.createdAt));
}

/** 정보 줄: 88px 이름 칸(캔버스 Calendar 노트 패널). */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-8 items-center text-ui">
      <dt className="w-[88px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

/**
 * 통합 일정 payload에는 평문 미리보기만 싣고, 패널을 연 노트의 본문만 권한을 다시 확인해 불러온다.
 * 수정 권한(관리자 또는 작성자)이 있으면 문서 페이지와 같은 편집기로 패널 안에서 바로 고친다.
 */
export function UnifiedNoteDetail({
  item,
  returnTo,
  viewer,
  onItemUpdated,
  onBusyChange,
}: {
  item: UnifiedItem;
  returnTo: string;
  viewer?: NoteDetailViewer;
  onItemUpdated?: (item: UnifiedItem) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const noteId = item.id;
  const preview = typeof item.metadata.preview === "string" ? item.metadata.preview : null;
  const [body, setBody] = useState<NoteBodyState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // 패널에서 저장한 시각. 저장 결과에는 서버 수정 시각이 없어 "수정" 줄은 이 시각으로 맞춘다.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { start: headerStartSlot, end: headerSlot } = useSlidePanelHeaderSlots();

  // 다른 노트로 바뀌면 렌더 중 바로 불러오는 상태로 돌린다. 다시 시도는 버튼 이벤트에서 같은 일을 한다.
  const [requestedNoteId, setRequestedNoteId] = useState(noteId);
  if (requestedNoteId !== noteId) {
    setRequestedNoteId(noteId);
    setBody({ status: "loading" });
    setSavedAt(null);
  }

  useEffect(() => {
    let active = true;
    getPrivateNote(noteId)
      .then((note) => {
        if (!active) return;
        setBody(note ? { status: "ready", note, loadedAt: Date.now() } : { status: "missing" });
      })
      .catch(() => {
        if (active) setBody({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [noteId, attempt]);

  const fullPageHref = `/dashboard/notes/${encodeURIComponent(noteId)}?returnTo=${encodeURIComponent(returnTo)}`;
  const canEdit = body.status === "ready" && Boolean(
    viewer && (viewer.role === "admin" || viewer.actorId === body.note.authorId),
  );
  const updatedLabel = body.status === "ready"
    ? savedAt !== null ? formatNoteUpdated(savedAt, savedAt) : formatNoteUpdated(body.note.updatedAt, body.loadedAt)
    : null;

  // 패널 안에서는 머리의 닫기 옆에 아이콘으로, 패널 밖에서는 본문 아래 링크로 둔다.
  const fullPageLink = body.status !== "missing" ? (
    headerSlot ? (
      <Link
        href={fullPageHref}
        className="flex size-11 items-center justify-center rounded-touch text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:size-8 md:rounded-md"
      >
        <Maximize2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
        <span className="sr-only">전체 화면으로 열기</span>
      </Link>
    ) : (
      <Link
        href={fullPageHref}
        className="inline-flex items-center gap-1.5 text-ui text-secondary-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <Maximize2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
        전체 화면으로 열기
      </Link>
    )
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      {body.status === "ready" ? (
        canEdit && viewer ? (
          <NoteEditorForm
            note={{
              id: body.note.id,
              title: body.note.title,
              contentHtml: body.note.contentHtml,
              noteDate: body.note.noteDate,
              version: body.note.version,
            }}
            actorId={viewer.actorId}
            action={(previous: UpdateNoteState, formData: FormData) => updatePrivateNote(noteId, previous, formData)}
            onSaved={(saved) => {
              setSavedAt(Date.now());
              onItemUpdated?.(applySavedNote(item, saved, body.note.createdAt));
            }}
            onBusyChange={onBusyChange}
            panel={{ statusSlot: headerStartSlot, authorName: body.note.authorName, updatedLabel }}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <h2 className="break-words text-2xl font-semibold tracking-display">{body.note.title}</h2>
            <dl className="flex flex-col">
              <MetaRow label="날짜" value={formatDetailDate(noteDateKey(body.note))} />
              {body.note.authorName ? <MetaRow label="작성자" value={body.note.authorName} /> : null}
              {updatedLabel ? <MetaRow label="수정" value={updatedLabel} /> : null}
            </dl>
            <div className="h-px bg-muted" aria-hidden="true" />
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyhole className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              다른 작성자의 노트는 읽기 전용입니다.
            </p>
            <RichTextContent html={body.note.contentHtml} />
          </div>
        )
      ) : body.status === "missing" ? (
        <p className="text-body text-muted-foreground" role="status">
          휴지통으로 옮겼거나 더 이상 볼 수 없는 노트입니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3" aria-busy={body.status === "loading"}>
          {preview ? (
            <p className="whitespace-pre-wrap break-words text-md/[26px] text-secondary-foreground">{preview}</p>
          ) : null}
          {body.status === "loading" ? (
            <p className="text-xs text-muted-foreground" role="status">전체 내용을 불러오는 중입니다.</p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-body">
              <span>전체 내용을 불러오지 못했습니다.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => {
                setBody({ status: "loading" });
                setAttempt((value) => value + 1);
              }}>
                다시 시도
              </Button>
            </div>
          )}
        </div>
      )}
      {/* 머리 왼쪽: 편집할 때는 편집기가 저장 상태를 두고, 그 밖에는 유형을 둔다. */}
      {headerStartSlot && !canEdit ? createPortal(<UnifiedItemTypeBadge item={item} />, headerStartSlot) : null}
      {fullPageLink && headerSlot ? createPortal(fullPageLink, headerSlot) : fullPageLink}
    </div>
  );
}
