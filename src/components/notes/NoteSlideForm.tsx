/**
 * @file src/components/notes/NoteSlideForm.tsx
 * @description SlidePanel 내 노트 인라인 작성 폼.
 * 저장 성공 시 `onSuccess(newItem)` 콜백으로 낙관적 업데이트 트리거.
 */
"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { createPrivateNote, type CreateNoteState } from "@/lib/actions/privateNotes";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { toKstDateInputValue } from "@/lib/date-input";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false },
);

interface NoteSlideFormProps {
  studentId: string;
  actorId: string;
  /** 캘린더 날짜 클릭 시 기본값 (YYYY-MM-DD) */
  defaultDate?: string;
  onSuccess: (item: UnifiedItem) => void;
  onClose: () => void;
  onBusyChange?: (isBusy: boolean) => void;
}

export function NoteSlideForm({
  studentId,
  actorId,
  defaultDate,
  onSuccess,
  onClose,
  onBusyChange,
}: NoteSlideFormProps) {
  const boundAction = createPrivateNote.bind(null, studentId);
  const today = toKstDateInputValue();
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState(defaultDate ?? today);
  const [contentHtml, setContentHtml] = useState("");
  const [state, formAction, isPending] = useActionState<CreateNoteState, FormData>(boundAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const submittedDraftRef = useRef<{
    title: string;
    noteDate: string;
    contentHtml: string;
  } | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);
  useBusyNavigationGuard(isPending);

  useEffect(() => {
    onBusyChange?.(isPending);
  }, [isPending, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 임시저장 복원/저장 (학생별 키)
  const {
    loaded,
    save,
    clear,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  } = useFormDraft<{ title: string; noteDate: string; contentHtml: string }>(
    createDocumentDraftKey("note", actorId, `new:${studentId}`),
    (d) => {
      setTitle(d.title ?? "");
      if (d.noteDate) setNoteDate(d.noteDate);
      setContentHtml(d.contentHtml ?? "");
    },
    {
      onReset: () => {
        setTitle("");
        setNoteDate(defaultDate ?? today);
        setContentHtml("");
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    const isEmpty = !title && isRichTextEmpty(contentHtml);
    if (isEmpty) {
      clear();
      return;
    }
    save({ title, noteDate, contentHtml });
  }, [loaded, title, noteDate, contentHtml, save, clear]);

  // 저장 성공 시 draft 삭제 + 낙관적 업데이트 + 패널 닫기
  useEffect(() => {
    if (
      state.success &&
      state.note &&
      handledNoteIdRef.current !== state.note.id
    ) {
      handledNoteIdRef.current = state.note.id;
      clear({
        reason: "submitted",
        submittedData: submittedDraftRef.current ?? { title, noteDate, contentHtml },
      });
      submittedDraftRef.current = null;
      const { id, title: savedTitle, contentHtml: savedContentHtml, noteDate: savedDate, createdAt } = state.note;
      const newItem: UnifiedItem = {
        id,
        type: "NOTE",
        title: savedTitle,
        date: new Date(savedDate ?? createdAt ?? Date.now()),
        metadata: { contentHtml: savedContentHtml, authorId: actorId, noteDate: savedDate },
      };
      onSuccess(newItem);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.note?.id]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
      onSubmit={() => {
        submittedDraftRef.current = { title, noteDate, contentHtml };
      }}
    >
      <input type="hidden" name="contentHtml" value={contentHtml} />

      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      {/* 제목 + 날짜 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="slide-note-title" className="text-sm font-medium">
            제목 <span className="text-destructive">*</span>
          </label>
          <Input
            id="slide-note-title"
            name="title"
            placeholder="오늘의 수업 요약"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5 sm:w-44">
          <label htmlFor="slide-note-date" className="text-sm font-medium">날짜</label>
          <Input
            id="slide-note-date"
            name="noteDate"
            type="date"
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      {/* 에디터 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          내용 <span className="text-destructive">*</span>
        </label>
        {loaded && (
          <FullEditor
            initialContent={contentHtml}
            onChange={setContentHtml}
            placeholder="수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
            disabled={isPending}
            minHeight="300px"
            ariaLabel="노트 내용"
            footer={
              <DraftStatus
                status={status}
                savedAt={savedAt}
                restored={restored}
                recoveries={recoveries}
                onRestoreRecovery={restoreRecovery}
                onDiscardRecovery={discardRecovery}
                disabled={isPending}
              />
            }
            onSave={() => formRef.current?.requestSubmit()}
          />
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending || !title.trim() || isRichTextEmpty(contentHtml)} className="flex-1">
          {isPending ? "저장 중..." : "노트 저장"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          취소
        </Button>
      </div>
    </form>
  );
}
