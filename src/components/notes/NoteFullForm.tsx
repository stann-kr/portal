/**
 * @file src/components/notes/NoteFullForm.tsx
 * @description 노트 작성 풀 페이지 클라이언트 폼.
 * 서버 컴포넌트에서 createPrivateNote.bind(null, studentId)로 바인딩된 action을 받아 사용.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateNoteState } from "@/lib/actions/privateNotes";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  isCreateNoteDraftEmpty,
  resolveRestoredCreateNoteDate,
} from "@/lib/note-draft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { resolveNoteCreateDefaultDate } from "@/lib/note-create-route";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);

interface NoteFullFormProps {
  /** createPrivateNote.bind(null, studentId) */
  action: (prev: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
  actorId: string;
  studentId: string;
  returnTo: string;
  /** 캘린더에서 선택한 날짜. 복구된 초안이 있으면 그 날짜가 우선한다. */
  defaultDate?: string;
  /** 작성 대상 학생 스페이스를 composer 상단에 명시한다. */
  spaceLabel?: string;
}

type CreateNoteDraft = {
  operationId?: string;
  title: string;
  noteDate: string;
  contentHtml: string;
};

export function NoteFullForm({ action, actorId, studentId, returnTo, defaultDate, spaceLabel }: NoteFullFormProps) {
  const initialDefaultDate = resolveNoteCreateDefaultDate(defaultDate, new Date());
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState(initialDefaultDate);
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
  const defaultNoteDateRef = useRef(initialDefaultDate);
  const [state, formAction, isPending] = useActionState<CreateNoteState, FormData>(
    action,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const submittedDraftRef = useRef<CreateNoteDraft | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);
  const router = useRouter();
  useBusyNavigationGuard(isPending);

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
    (draft) => {
      setOperationId(
        parseCreationOperationId(draft.operationId) ?? createCreationOperationId(),
      );
      setTitle(draft.title ?? "");
      setNoteDate(
        resolveRestoredCreateNoteDate(
          draft.noteDate,
          defaultNoteDateRef.current,
        ),
      );
      setContentHtml(draft.contentHtml ?? "");
    },
    {
      onReset: () => {
        defaultNoteDateRef.current = initialDefaultDate;
        setOperationId(createCreationOperationId());
        setTitle("");
        setNoteDate(initialDefaultDate);
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
    if (
      isCreateNoteDraftEmpty(
        { title, noteDate, contentHtml: latestContentHtml },
        defaultNoteDateRef.current,
      )
    ) {
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
    clear,
    contentHtml,
    loaded,
    noteDate,
    operationId,
    readLatestContentHtml,
    save,
    title,
  ]);

  useEffect(() => {
    if (!state.note?.id || handledNoteIdRef.current === state.note.id) return;
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
    router.replace(`/dashboard/notes/${state.note.id}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [clear, contentHtml, noteDate, operationId, returnTo, router, state.note?.id, title]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-6 px-4">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={returnTo}
          aria-disabled={isPending}
          tabIndex={isPending ? -1 : undefined}
          className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ${
            isPending ? "pointer-events-none opacity-50" : ""
          }`}
          onClick={(event) => {
            if (isPending) event.preventDefault();
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          포털로 돌아가기
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">노트 작성</h1>
            {spaceLabel ? <p className="mt-1 text-sm text-muted-foreground">대상 스페이스 · {spaceLabel}</p> : null}
          </div>
          <Link
            href={`/dashboard/notes/trash?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            휴지통
          </Link>
        </div>
      </div>

      <form
        ref={formRef}
        action={formAction}
        aria-busy={!loaded || isPending}
        className="space-y-5"
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

        {state?.error && (!state.operationConflict || hasOperationConflict) && (
          <div role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {state.error}
          </div>
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

        {state?.success && (
          <div
            role="status"
            className="rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success"
          >
            노트가 저장되었습니다.
          </div>
        )}

        {/* 제목 + 날짜 */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="note-title" className="text-sm font-medium">
              제목 <span className="text-destructive">*</span>
            </label>
            <Input
              id="note-title"
              name="title"
              placeholder="오늘의 수업 요약"
              required
              maxLength={200}
              disabled={!loaded || isPending}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:w-44">
            <label htmlFor="note-date" className="text-sm font-medium">
              날짜
            </label>
            <Input
              id="note-date"
              name="noteDate"
              type="date"
              value={noteDate}
              onChange={(event) => setNoteDate(event.target.value)}
              disabled={!loaded || isPending}
            />
          </div>
        </div>

        {/* 에디터 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </label>
          {loaded ? (
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
          ) : null}
        </div>

        {/* 버튼 */}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={!loaded || !canSubmit || isPending || !operationId || !title.trim() || isRichTextEmpty(contentHtml)}
            className="flex-1 gap-2"
          >
            <Save className="w-4 h-4" />
            {isPending ? "저장 중..." : "노트 저장"}
          </Button>
          <Button variant="outline" asChild>
            <Link
              href={returnTo}
              aria-disabled={isPending}
              tabIndex={isPending ? -1 : undefined}
              className={isPending ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                if (isPending) event.preventDefault();
              }}
            >
              취소
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
