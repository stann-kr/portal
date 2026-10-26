"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LockKeyhole, Maximize2 } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { NoteEditorForm, type SavedNote } from "@/components/notes/NoteEditorForm";
import { Button } from "@/components/ui/button";
import { getPrivateNote, updatePrivateNote, type UpdateNoteState } from "@/lib/actions/privateNotes";
import { createNotePreview } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

type LoadedNote = NonNullable<Awaited<ReturnType<typeof getPrivateNote>>>;

type NoteBodyState =
  | { status: "loading" }
  | { status: "ready"; note: LoadedNote }
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

  // 다른 노트로 바뀌면 렌더 중 바로 불러오는 상태로 돌린다. 다시 시도는 버튼 이벤트에서 같은 일을 한다.
  const [requestedNoteId, setRequestedNoteId] = useState(noteId);
  if (requestedNoteId !== noteId) {
    setRequestedNoteId(noteId);
    setBody({ status: "loading" });
  }

  useEffect(() => {
    let active = true;
    getPrivateNote(noteId)
      .then((note) => {
        if (!active) return;
        setBody(note ? { status: "ready", note } : { status: "missing" });
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

  return (
    <div className="space-y-5">
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
            onSaved={(saved) => onItemUpdated?.(applySavedNote(item, saved, body.note.createdAt))}
            onBusyChange={onBusyChange}
          />
        ) : (
          <div className="space-y-4">
            <h2 className="break-words text-xl font-semibold tracking-[-0.01em]">{body.note.title}</h2>
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockKeyhole className="size-3.5" aria-hidden="true" />
              다른 작성자의 노트는 읽기 전용입니다.
            </p>
            <RichTextContent html={body.note.contentHtml} />
          </div>
        )
      ) : body.status === "missing" ? (
        <p className="text-sm text-muted-foreground" role="status">
          휴지통으로 옮겼거나 더 이상 볼 수 없는 노트입니다.
        </p>
      ) : (
        <div className="space-y-3" aria-busy={body.status === "loading"}>
          {preview ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{preview}</p>
          ) : null}
          {body.status === "loading" ? (
            <p className="text-xs text-muted-foreground" role="status">전체 내용을 불러오는 중입니다.</p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
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
      {body.status !== "missing" ? (
        <Link
          href={fullPageHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
          전체 화면으로 열기
        </Link>
      ) : null}
    </div>
  );
}
