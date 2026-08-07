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
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createPrivateNote, type CreateNoteState } from "@/lib/actions/privateNotes";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  isCreateNoteDraftEmpty,
  resolveRestoredCreateNoteDate,
} from "@/lib/note-draft";
import { toKstDateInputValue } from "@/lib/date-input";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false },
);

interface NoteSlideFormProps {
  studentId: string;
  actorId: string;
  returnTo: string;
  /** 캘린더 날짜 클릭 시 기본값 (YYYY-MM-DD) */
  defaultDate?: string;
  onSuccess: (item: UnifiedItem) => void;
  onClose: () => void;
  onBusyChange?: (isBusy: boolean) => void;
}

type CreateNoteDraft = {
  operationId?: string;
  title: string;
  noteDate: string;
  contentHtml: string;
};

export function NoteSlideForm({
  studentId,
  actorId,
  returnTo,
  defaultDate,
  onSuccess,
  onClose,
  onBusyChange,
}: NoteSlideFormProps) {
  const boundAction = createPrivateNote.bind(null, studentId);
  const today = toKstDateInputValue();
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState(defaultDate ?? today);
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent("");
  const [operationId, setOperationId] = useState("");
  const defaultNoteDateRef = useRef(defaultDate ?? today);
  const [state, formAction, isPending] = useActionState<CreateNoteState, FormData>(boundAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<CreateNoteDraft | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);
  useBusyNavigationGuard(isPending);

  useEffect(() => {
    onBusyChange?.(isPending);
  }, [isPending, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 임시저장 복원/저장 (학생별 키)
  const {
    loaded,
    canSubmit,
    save,
    clear,
    flush,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
    serverSync,
  } = useSyncedFormDraft<CreateNoteDraft>(
    createDocumentDraftKey("note", actorId, `new:${studentId}`),
    (d) => {
      setOperationId(
        parseCreationOperationId(d.operationId) ?? createCreationOperationId(),
      );
      setTitle(d.title ?? "");
      setNoteDate(
        resolveRestoredCreateNoteDate(
          d.noteDate,
          defaultNoteDateRef.current,
        ),
      );
      setContentHtml(d.contentHtml ?? "");
    },
    {
      onReset: () => {
        defaultNoteDateRef.current = defaultDate ?? today;
        setOperationId(createCreationOperationId());
        setTitle("");
        setNoteDate(defaultDate ?? today);
        setContentHtml("");
      },
    },
  );

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !loaded || !canSubmit || isPending || !operationId,
    onSave: () => formRef.current?.requestSubmit(),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const isEmpty = isCreateNoteDraftEmpty(
      { title, noteDate, contentHtml: latestContentHtml },
      defaultNoteDateRef.current,
    );
    if (isEmpty) {
      clear();
      return;
    }
    if (!operationId) return;
    save({
      operationId,
      title,
      noteDate,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [
    loaded,
    title,
    noteDate,
    contentHtml,
    operationId,
    readLatestContentHtml,
    save,
    clear,
  ]);

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
        submittedData: submittedDraftRef.current ?? {
          operationId,
          title,
          noteDate,
          contentHtml,
        },
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

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      className="space-y-4"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || !canSubmit || isPending || !operationId) {
          event.preventDefault();
          return;
        }
        const latestContentHtml = commitLatestContentHtml();
        if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
          event.preventDefault();
          return;
        }
        if (contentHtmlInputRef.current) {
          contentHtmlInputRef.current.value = latestContentHtml;
        }
        const submittedDraft = {
          operationId,
          title,
          noteDate,
          contentHtml: latestContentHtml,
        };
        save({
          operationId,
          title,
          noteDate,
          get contentHtml() {
            return readLatestContentHtml();
          },
        });
        flush();
        submittedDraftRef.current = submittedDraft;
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />

      {state.error && (!state.operationConflict || hasOperationConflict) && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}

      {hasOperationConflict && state.existingId ? (
        <CreationConflictActions
          existingHref={`/dashboard/notes/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
          existingLabel="기존 노트 열기"
          separateLabel="별도 노트로 저장"
          onSeparate={() => setOperationId(createCreationOperationId())}
          disabled={isPending}
        />
      ) : null}

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
            maxLength={200}
            disabled={!loaded || isPending}
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
            disabled={!loaded || isPending}
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
            contentVersion={contentVersion}
            onChange={handleEditorChange}
            onDirty={(reader) => {
              handleEditorDirty(reader);
              if (!operationId) return;
              save({
                operationId,
                title,
                noteDate,
                get contentHtml() {
                  return reader();
                },
              });
            }}
            placeholder="수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
            disabled={isPending}
            minHeight="300px"
            ariaLabel="노트 내용"
            footer={
              <DraftStatus
                status={status}
                canSubmit={canSubmit}
                savedAt={savedAt}
                restored={restored}
                recoveries={recoveries}
                onRestoreRecovery={restoreRecovery}
                onDiscardRecovery={discardRecovery}
                serverSync={serverSync}
                disabled={isPending}
              />
            }
            saveShortcutLabel={canSubmit ? "노트 저장" : undefined}
          />
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={!loaded || !canSubmit || isPending || !operationId || !title.trim() || isRichTextEmpty(contentHtml)} className="flex-1">
          {isPending ? "저장 중..." : "노트 저장"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          취소
        </Button>
      </div>
    </form>
  );
}
