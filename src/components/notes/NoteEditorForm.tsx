"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import type { UpdateNoteState } from "@/lib/actions/privateNotes";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type NoteEditorFormProps = {
  note: {
    id: string;
    title: string;
    contentHtml: string;
    noteDate: Date | null;
  };
  actorId: string;
  action: (previous: UpdateNoteState, formData: FormData) => Promise<UpdateNoteState>;
};

function toDateInputValue(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function NoteEditorForm({ note, actorId, action }: NoteEditorFormProps) {
  const [title, setTitle] = useState(note.title);
  const [noteDate, setNoteDate] = useState(toDateInputValue(note.noteDate));
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent(note.contentHtml);
  const [hasStaleDraftBase, setHasStaleDraftBase] = useState(false);
  const [state, formAction, isPending] = useActionState<UpdateNoteState, FormData>(action, {});
  useBusyNavigationGuard(isPending);
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const handledSavedNoteRef = useRef<UpdateNoteState["note"]>(undefined);
  const submittedDraftRef = useRef<{
    title: string;
    noteDate: string;
    contentHtml: string;
    base: { title: string; noteDate: string; contentHtml: string };
  } | null>(null);
  const savedSnapshotRef = useRef({
    title: note.title,
    noteDate: toDateInputValue(note.noteDate),
    contentHtml: note.contentHtml,
  });
  const draftBaseRef = useRef({
    title: note.title,
    noteDate: toDateInputValue(note.noteDate),
    contentHtml: note.contentHtml,
  });
  const serverSnapshot = useMemo(
    () => ({
      title: note.title,
      noteDate: toDateInputValue(note.noteDate),
      contentHtml: note.contentHtml,
    }),
    [note.contentHtml, note.noteDate, note.title],
  );
  const previousServerSnapshotRef = useRef(serverSnapshot);

  const {
    loaded,
    save,
    clear,
    flush,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  } = useFormDraft<{
    title: string;
    noteDate: string;
    contentHtml: string;
    base?: { title: string; noteDate: string; contentHtml: string };
  }>(
    createDocumentDraftKey("note", actorId, note.id),
    (draft) => {
      const restoredSnapshot = {
        title: draft.title ?? note.title,
        noteDate: draft.noteDate ?? toDateInputValue(note.noteDate),
        contentHtml: draft.contentHtml ?? note.contentHtml,
      };
      const draftMatchesCurrentServer =
        restoredSnapshot.title === serverSnapshot.title &&
        restoredSnapshot.noteDate === serverSnapshot.noteDate &&
        restoredSnapshot.contentHtml === serverSnapshot.contentHtml;
      draftBaseRef.current = serverSnapshot;
      setHasStaleDraftBase(false);
      if (
        draft.base &&
        typeof draft.base.title === "string" &&
        typeof draft.base.noteDate === "string" &&
        typeof draft.base.contentHtml === "string"
      ) {
        draftBaseRef.current = draft.base;
        const matchesCurrentServer =
          draft.base.title === serverSnapshot.title &&
          draft.base.noteDate === serverSnapshot.noteDate &&
          draft.base.contentHtml === serverSnapshot.contentHtml;
        if (matchesCurrentServer || draftMatchesCurrentServer) {
          savedSnapshotRef.current = serverSnapshot;
          draftBaseRef.current = serverSnapshot;
        }
        setHasStaleDraftBase(!matchesCurrentServer && !draftMatchesCurrentServer);
      }
      setTitle(restoredSnapshot.title);
      setNoteDate(restoredSnapshot.noteDate);
      setContentHtml(restoredSnapshot.contentHtml);
    },
    {
      onReset: () => {
        savedSnapshotRef.current = serverSnapshot;
        draftBaseRef.current = serverSnapshot;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setNoteDate(serverSnapshot.noteDate);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: !loaded || isPending || hasStaleDraftBase,
    onSave: () => formRef.current?.requestSubmit(),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const matchesServer =
      title === savedSnapshotRef.current.title &&
      noteDate === savedSnapshotRef.current.noteDate &&
      latestContentHtml === savedSnapshotRef.current.contentHtml;
    if (!hasStaleDraftBase && matchesServer) {
      clear();
      return;
    }
    save({
      title,
      noteDate,
      get contentHtml() {
        return readLatestContentHtml();
      },
      base: hasStaleDraftBase ? draftBaseRef.current : savedSnapshotRef.current,
    });
  }, [
    clear,
    contentHtml,
    hasStaleDraftBase,
    loaded,
    noteDate,
    readLatestContentHtml,
    save,
    title,
  ]);

  useEffect(() => {
    if (!loaded) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      previousServer.title !== serverSnapshot.title ||
      previousServer.noteDate !== serverSnapshot.noteDate ||
      previousServer.contentHtml !== serverSnapshot.contentHtml;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    // React 표시값은 editor보다 최대 200ms 늦을 수 있으므로 충돌 판정은 최신 reader를 사용한다.
    const latestContentHtml = readLatestContentHtml();
    const localMatchesPrevious =
      title === previousServer.title &&
      noteDate === previousServer.noteDate &&
      latestContentHtml === previousServer.contentHtml;
    const localMatchesCurrent =
      title === serverSnapshot.title &&
      noteDate === serverSnapshot.noteDate &&
      latestContentHtml === serverSnapshot.contentHtml;

    if (localMatchesCurrent || (!hasStaleDraftBase && localMatchesPrevious)) {
      clear();
      savedSnapshotRef.current = serverSnapshot;
      draftBaseRef.current = serverSnapshot;
      setTitle(serverSnapshot.title);
      setNoteDate(serverSnapshot.noteDate);
      setContentHtml(serverSnapshot.contentHtml);
      setHasStaleDraftBase(false);
      return;
    }

    if (!hasStaleDraftBase) draftBaseRef.current = savedSnapshotRef.current;
    setHasStaleDraftBase(true);
  }, [
    clear,
    hasStaleDraftBase,
    loaded,
    noteDate,
    readLatestContentHtml,
    serverSnapshot,
    setContentHtml,
    title,
  ]);

  useEffect(() => {
    if (!state.note?.id || handledSavedNoteRef.current === state.note) return;
    handledSavedNoteRef.current = state.note;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        title,
        noteDate,
        contentHtml,
        base: savedSnapshotRef.current,
      },
    });
    submittedDraftRef.current = null;
    savedSnapshotRef.current = {
      title: state.note.title,
      noteDate: toDateInputValue(state.note.noteDate),
      contentHtml: state.note.contentHtml,
    };
    draftBaseRef.current = savedSnapshotRef.current;
    setTitle(state.note.title);
    setNoteDate(toDateInputValue(state.note.noteDate));
    setContentHtml(state.note.contentHtml);
  }, [clear, contentHtml, noteDate, setContentHtml, state.note, title]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      className="space-y-5"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || isPending || hasStaleDraftBase) {
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
          title,
          noteDate,
          contentHtml: latestContentHtml,
          base: { ...savedSnapshotRef.current },
        };
        save({
          title,
          noteDate,
          get contentHtml() {
            return readLatestContentHtml();
          },
          base: { ...savedSnapshotRef.current },
        });
        flush();
        submittedDraftRef.current = submittedDraft;
      }}
    >
      <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />
      <input type="hidden" name="baseTitle" value={savedSnapshotRef.current.title} />
      <input type="hidden" name="baseContentHtml" value={savedSnapshotRef.current.contentHtml} />
      <input type="hidden" name="baseNoteDate" value={savedSnapshotRef.current.noteDate} />

      {state.error ? (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive-muted p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="rounded-lg border border-success/20 bg-success-muted p-3 text-sm text-success">
          변경사항을 저장했습니다.
        </p>
      ) : null}
      {hasStaleDraftBase ? (
        <DraftConflictRecovery
          documentLabel="노트"
          onUseServer={() => {
            clear();
            savedSnapshotRef.current = serverSnapshot;
            draftBaseRef.current = serverSnapshot;
            setTitle(serverSnapshot.title);
            setNoteDate(serverSnapshot.noteDate);
            setContentHtml(serverSnapshot.contentHtml);
            setHasStaleDraftBase(false);
          }}
          onKeepDraft={() => {
            savedSnapshotRef.current = serverSnapshot;
            draftBaseRef.current = serverSnapshot;
            setHasStaleDraftBase(false);
          }}
        />
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="min-w-0 flex-1 space-y-1.5">
          <span className="text-sm font-medium">제목</span>
          <Input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            disabled={!loaded || isPending}
          />
        </label>
        <label className="space-y-1.5 sm:w-44">
          <span className="text-sm font-medium">날짜</span>
          <Input
            name="noteDate"
            type="date"
            value={noteDate}
            onChange={(event) => setNoteDate(event.target.value)}
            disabled={!loaded || isPending}
          />
        </label>
      </div>

      {loaded ? (
        <FullEditor
          initialContent={contentHtml}
          contentVersion={contentVersion}
          onChange={handleEditorChange}
          onDirty={(reader) => {
            handleEditorDirty(reader);
            save({
              title,
              noteDate,
              get contentHtml() {
                return reader();
              },
              base: hasStaleDraftBase
                ? draftBaseRef.current
                : savedSnapshotRef.current,
            });
          }}
          placeholder="수업 내용, 연습 기록, 메모를 이어서 작성하세요..."
          minHeight="min(60dvh, 42rem)"
          disabled={isPending}
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
          onSave={() => {
            if (!isPending && !hasStaleDraftBase) formRef.current?.requestSubmit();
          }}
        />
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!loaded || isPending || hasStaleDraftBase || !title.trim() || isRichTextEmpty(contentHtml)}
          className="gap-2"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
