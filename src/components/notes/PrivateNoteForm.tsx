"use client";

import { useActionState, useCallback, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { createPrivateNote, type CreateNoteState } from "@/lib/actions/privateNotes";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  isCreateNoteDraftEmpty,
  resolveRestoredCreateNoteDate,
} from "@/lib/note-draft";
import {
  acknowledgeServerSaveResponse,
  createServerSaveConfirmationState,
  dismissServerSaveConfirmation,
  isServerSaveConfirmationVisible,
} from "@/lib/server-save-confirmation";
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
  { ssr: false }
);

const initialState: CreateNoteState = {};

type CreateNoteDraft = {
  operationId?: string;
  title: string;
  noteDate: string;
  contentHtml: string;
};

export function PrivateNoteForm({
  studentId,
  actorId,
  returnTo,
}: {
  studentId: string;
  actorId: string;
  returnTo: string;
}) {
  const boundAction = createPrivateNote.bind(null, studentId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  useBusyNavigationGuard(pending);
  const today = toKstDateInputValue();
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState(today);
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
  const [editorKey, setEditorKey] = useState(0);
  const defaultNoteDateRef = useRef(today);
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<CreateNoteDraft | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);
  const [saveConfirmation, setSaveConfirmation] = useState(
    createServerSaveConfirmationState<string>(),
  );
  const hideSaveConfirmation = useCallback(() => {
    setSaveConfirmation(dismissServerSaveConfirmation);
  }, []);

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
      hideSaveConfirmation();
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
        hideSaveConfirmation();
        defaultNoteDateRef.current = today;
        setOperationId(createCreationOperationId());
        setTitle("");
        setNoteDate(today);
        setContentHtml("");
        setEditorKey((key) => key + 1);
      },
    },
  );

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !loaded || !canSubmit || pending || !operationId,
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

  // 저장 성공 시 draft 삭제 + 폼 초기화 (에디터 remount)
  useEffect(() => {
    if (
      state.success &&
      state.note?.id &&
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
      defaultNoteDateRef.current = today;
      setOperationId(createCreationOperationId());
      setTitle("");
      setNoteDate(today);
      setContentHtml("");
      setEditorKey((k) => k + 1);
      setSaveConfirmation((current) =>
        acknowledgeServerSaveResponse(current, state.note?.id),
      );
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
      aria-busy={!loaded || pending}
      className="space-y-4"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || !canSubmit || pending || !operationId) {
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

      {state.error && (!state.operationConflict || hasOperationConflict) && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}
      {hasOperationConflict && state.existingId ? (
        <CreationConflictActions
          existingHref={`/dashboard/notes/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
          existingLabel="기존 노트 열기"
          separateLabel="별도 노트로 저장"
          onSeparate={() => setOperationId(createCreationOperationId())}
          disabled={pending}
        />
      ) : null}
      {state.success &&
      isServerSaveConfirmationVisible(saveConfirmation, state.note?.id) && (
        <p role="status" className="text-sm text-success">노트가 저장되었습니다.</p>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 space-y-2">
          <label htmlFor="title" className="text-sm font-medium">제목</label>
          <Input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            placeholder="오늘의 수업 요약"
            value={title}
            onChange={(e) => {
              hideSaveConfirmation();
              setTitle(e.target.value);
            }}
            disabled={!loaded || pending}
          />
        </div>
        <div className="space-y-2 sm:w-44">
          <label htmlFor="note-date" className="text-sm font-medium">날짜</label>
          <Input
            id="note-date"
            name="noteDate"
            type="date"
            value={noteDate}
            onChange={(e) => {
              hideSaveConfirmation();
              setNoteDate(e.target.value);
            }}
            disabled={!loaded || pending}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">내용</label>
        <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />
        {loaded && (
          <FullEditor
            key={editorKey}
            initialContent={contentHtml}
            contentVersion={contentVersion}
            onChange={handleEditorChange}
            onDirty={(reader) => {
              hideSaveConfirmation();
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
            placeholder="수업 내용, 메모 등을 작성하세요..."
            disabled={pending}
            minHeight="300px"
            ariaLabel="노트 내용"
            footer={
              <DraftStatus
                status={status}
                canSubmit={canSubmit}
                savedAt={savedAt}
                restored={restored}
                recoveries={recoveries}
                onRestoreRecovery={(storageKey) => {
                  hideSaveConfirmation();
                  restoreRecovery(storageKey);
                }}
                onDiscardRecovery={discardRecovery}
                serverSync={serverSync}
                disabled={pending}
              />
            }
            saveShortcutLabel={canSubmit ? "노트 저장" : undefined}
          />
        )}
      </div>

      <Button type="submit" disabled={!loaded || !canSubmit || pending || !operationId || !title.trim() || isRichTextEmpty(contentHtml)} className="w-full">
        {pending ? "작성 중..." : "노트 저장"}
      </Button>
    </form>
  );
}
