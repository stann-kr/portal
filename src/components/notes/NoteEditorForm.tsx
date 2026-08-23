"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import type { UpdateNoteState } from "@/lib/actions/privateNotes";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import {
  PRIVATE_NOTE_BASE_REVISION_FIELD,
  parsePrivateNoteRevision,
} from "@/lib/private-note-continuity";
import {
  createDocumentSnapshotFingerprint,
  DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
} from "@/lib/document-snapshot-fingerprint";
import {
  createDocumentEditDraftMetadata,
  resolveDocumentEditDraftBase,
  type CompactDocumentEditDraftMetadata,
  type DocumentEditDraftBaseFields,
} from "@/lib/document-edit-draft";
import {
  acknowledgeServerSaveResponse,
  createServerSaveConfirmationState,
  dismissServerSaveConfirmation,
  isServerSaveConfirmationVisible,
} from "@/lib/server-save-confirmation";

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
    version?: number;
  };
  actorId: string;
  action: (previous: UpdateNoteState, formData: FormData) => Promise<UpdateNoteState>;
};

type NoteEditSnapshot = {
  title: string;
  noteDate: string;
  contentHtml: string;
};

type NoteOperationDraftFields = {
  operationId?: string;
  baseRevision?: number;
};

type NoteEditDraft = NoteEditSnapshot &
  DocumentEditDraftBaseFields &
  NoteOperationDraftFields;
type CompactNoteEditDraft = NoteEditSnapshot &
  CompactDocumentEditDraftMetadata &
  NoteOperationDraftFields;

type ConflictServerState = {
  snapshot: NoteEditSnapshot;
  version: number;
};

function toDateInputValue(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function NoteEditorForm({ note, actorId, action }: NoteEditorFormProps) {
  const serverVersion = note.version ?? 1;
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
  const [operationId, setOperationId] = useState("");
  const [baseRevision, setBaseRevision] = useState(serverVersion);
  const [state, formAction, isPending] = useActionState<UpdateNoteState, FormData>(action, {});
  useBusyNavigationGuard(isPending);
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const handledSavedNoteRef = useRef<UpdateNoteState["note"]>(undefined);
  const handledConflictNoteRef = useRef<UpdateNoteState["conflictNote"]>(undefined);
  const conflictServerRef = useRef<ConflictServerState | null>(null);
  const submittedDraftRef = useRef<CompactNoteEditDraft | null>(null);
  const submittedOperationIdRef = useRef<string | null>(null);
  const submittedDraftAliasesRef = useRef<readonly NoteEditDraft[] | null>(null);
  const restoredDraftRef = useRef<NoteEditDraft | null>(null);
  const savedSnapshotRef = useRef({
    title: note.title,
    noteDate: toDateInputValue(note.noteDate),
    contentHtml: note.contentHtml,
  });
  const [baseFingerprint, setBaseFingerprint] = useState(() =>
    createDocumentSnapshotFingerprint({
      kind: "private-note",
      id: note.id,
      title: note.title,
      contentHtml: note.contentHtml,
      noteDate: toDateInputValue(note.noteDate),
    }),
  );
  const baseFingerprintRef = useRef(baseFingerprint);
  const draftBaseFingerprintRef = useRef(baseFingerprint);
  const adoptSavedSnapshot = useCallback(
    (snapshot: NoteEditSnapshot) => {
      savedSnapshotRef.current = snapshot;
      const fingerprint = createDocumentSnapshotFingerprint({
        kind: "private-note",
        id: note.id,
        title: snapshot.title,
        contentHtml: snapshot.contentHtml,
        noteDate: snapshot.noteDate,
      });
      baseFingerprintRef.current = fingerprint;
      setBaseFingerprint(fingerprint);
    },
    [note.id],
  );
  const serverSnapshot = useMemo(
    () => ({
      title: note.title,
      noteDate: toDateInputValue(note.noteDate),
      contentHtml: note.contentHtml,
    }),
    [note.contentHtml, note.noteDate, note.title],
  );
  const previousServerSnapshotRef = useRef(serverSnapshot);
  const createSubmittedDraftAliases = useCallback(
    (snapshot: NoteEditSnapshot): readonly NoteEditDraft[] => {
      const aliases: NoteEditDraft[] = [
        { ...snapshot },
        { ...snapshot, base: { ...savedSnapshotRef.current } },
      ];
      const restoredDraft = restoredDraftRef.current;
      if (
        restoredDraft &&
        restoredDraft.title === snapshot.title &&
        restoredDraft.noteDate === snapshot.noteDate &&
        restoredDraft.contentHtml === snapshot.contentHtml
      ) {
        aliases.push(restoredDraft);
      }
      return aliases;
    },
    [],
  );
  const [saveConfirmation, setSaveConfirmation] = useState(
    createServerSaveConfirmationState<NonNullable<UpdateNoteState["note"]>>(),
  );
  const hideSaveConfirmation = useCallback(() => {
    setSaveConfirmation(dismissServerSaveConfirmation);
  }, []);

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
  } = useSyncedFormDraft<NoteEditDraft>(
    createDocumentDraftKey("note", actorId, note.id),
    (draft) => {
      restoredDraftRef.current = draft;
      setOperationId(
        parseCreationOperationId(draft.operationId) ??
          createCreationOperationId(),
      );
      setBaseRevision(
        parsePrivateNoteRevision(draft.baseRevision) ?? serverVersion,
      );
      hideSaveConfirmation();
      const restoredSnapshot = {
        title: draft.title ?? note.title,
        noteDate: draft.noteDate ?? toDateInputValue(note.noteDate),
        contentHtml: draft.contentHtml ?? note.contentHtml,
      };
      const draftMatchesCurrentServer =
        restoredSnapshot.title === serverSnapshot.title &&
        restoredSnapshot.noteDate === serverSnapshot.noteDate &&
        restoredSnapshot.contentHtml === serverSnapshot.contentHtml;
      const resolvedBase = resolveDocumentEditDraftBase(
        draft,
        {
          kind: "private-note",
          id: note.id,
          title: serverSnapshot.title,
          noteDate: serverSnapshot.noteDate,
          contentHtml: serverSnapshot.contentHtml,
        },
        draftMatchesCurrentServer,
      );
      draftBaseFingerprintRef.current = resolvedBase.draftBaseFingerprint;
      setHasStaleDraftBase(resolvedBase.hasStaleDraftBase);
      if (!resolvedBase.hasStaleDraftBase) {
        adoptSavedSnapshot(serverSnapshot);
      }
      setTitle(restoredSnapshot.title);
      setNoteDate(restoredSnapshot.noteDate);
      setContentHtml(restoredSnapshot.contentHtml);
    },
    {
      onReset: () => {
        restoredDraftRef.current = null;
        setOperationId(createCreationOperationId());
        setBaseRevision(serverVersion);
        hideSaveConfirmation();
        adoptSavedSnapshot(serverSnapshot);
        draftBaseFingerprintRef.current = baseFingerprintRef.current;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setNoteDate(serverSnapshot.noteDate);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );

  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled:
      !loaded || !canSubmit || isPending || hasStaleDraftBase || !operationId,
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
      restoredDraftRef.current = null;
      clear();
      return;
    }
    save({
      title,
      noteDate,
      operationId,
      baseRevision,
      ...createDocumentEditDraftMetadata(
        hasStaleDraftBase
          ? draftBaseFingerprintRef.current
          : baseFingerprintRef.current,
      ),
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [
    clear,
    contentHtml,
    hasStaleDraftBase,
    loaded,
    noteDate,
    operationId,
    baseRevision,
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
    const serverMatchesLatestSaveResponse = Boolean(
      state.success &&
      state.note &&
      state.note.title === serverSnapshot.title &&
      toDateInputValue(state.note.noteDate) === serverSnapshot.noteDate &&
      state.note.contentHtml === serverSnapshot.contentHtml,
    );
    if (!serverMatchesLatestSaveResponse) hideSaveConfirmation();
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
      restoredDraftRef.current = null;
      clear();
      adoptSavedSnapshot(serverSnapshot);
      setBaseRevision(serverVersion);
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
      setTitle(serverSnapshot.title);
      setNoteDate(serverSnapshot.noteDate);
      setContentHtml(serverSnapshot.contentHtml);
      setHasStaleDraftBase(false);
      return;
    }

    if (!hasStaleDraftBase) {
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
    }
    setHasStaleDraftBase(true);
  }, [
    adoptSavedSnapshot,
    clear,
    hasStaleDraftBase,
    hideSaveConfirmation,
    loaded,
    noteDate,
    readLatestContentHtml,
    serverSnapshot,
    serverVersion,
    setContentHtml,
    state.note,
    state.success,
    title,
  ]);

  useEffect(() => {
    if (
      !state.conflictNote ||
      handledConflictNoteRef.current === state.conflictNote
    ) {
      return;
    }
    handledConflictNoteRef.current = state.conflictNote;
    conflictServerRef.current = {
      snapshot: {
        title: state.conflictNote.title,
        noteDate: toDateInputValue(state.conflictNote.noteDate),
        contentHtml: state.conflictNote.contentHtml,
      },
      version: state.conflictNote.version,
    };
    if (!hasStaleDraftBase) {
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
    }
    hideSaveConfirmation();
    setHasStaleDraftBase(true);
  }, [hasStaleDraftBase, hideSaveConfirmation, state.conflictNote]);

  useEffect(() => {
    if (
      !state.success ||
      !state.note?.id ||
      handledSavedNoteRef.current === state.note
    ) {
      return;
    }
    handledSavedNoteRef.current = state.note;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        title,
        noteDate,
        contentHtml,
        ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
      },
      submittedAliases:
        submittedDraftAliasesRef.current ??
        createSubmittedDraftAliases({ title, noteDate, contentHtml }),
    });
    submittedDraftRef.current = null;
    submittedOperationIdRef.current = null;
    submittedDraftAliasesRef.current = null;
    restoredDraftRef.current = null;
    conflictServerRef.current = null;
    const savedSnapshot = {
      title: state.note.title,
      noteDate: toDateInputValue(state.note.noteDate),
      contentHtml: state.note.contentHtml,
    };
    adoptSavedSnapshot(savedSnapshot);
    setBaseRevision(
      (currentRevision) =>
        state.note?.version ?? state.currentRevision ?? currentRevision,
    );
    setOperationId(createCreationOperationId());
    draftBaseFingerprintRef.current = baseFingerprintRef.current;
    setHasStaleDraftBase(false);
    setTitle(state.note.title);
    setNoteDate(toDateInputValue(state.note.noteDate));
    setContentHtml(state.note.contentHtml);
    setSaveConfirmation((current) =>
      acknowledgeServerSaveResponse(current, state.note),
    );
  }, [
    adoptSavedSnapshot,
    clear,
    contentHtml,
    createSubmittedDraftAliases,
    noteDate,
    setContentHtml,
    state.currentRevision,
    state.note,
    state.success,
    title,
  ]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      className="space-y-5"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (
          !loaded ||
          !canSubmit ||
          isPending ||
          hasStaleDraftBase ||
          !operationId
        ) {
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
        const submittedDraft: CompactNoteEditDraft = {
          title,
          noteDate,
          contentHtml: latestContentHtml,
          operationId,
          baseRevision,
          ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
        };
        save(submittedDraft);
        flush();
        submittedDraftRef.current = submittedDraft;
        submittedOperationIdRef.current = operationId;
        submittedDraftAliasesRef.current = createSubmittedDraftAliases({
          title,
          noteDate,
          contentHtml: latestContentHtml,
        });
      }}
    >
      <input ref={contentHtmlInputRef} type="hidden" name="contentHtml" value={contentHtml} />
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <input
        type="hidden"
        name={PRIVATE_NOTE_BASE_REVISION_FIELD}
        value={baseRevision}
      />
      <input
        type="hidden"
        name={DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD}
        value={baseFingerprint}
      />

      {state.error ? (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive-muted p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success &&
      isServerSaveConfirmationVisible(saveConfirmation, state.note) ? (
        <p role="status" className="rounded-lg border border-success/20 bg-success-muted p-3 text-sm text-success">
          변경사항을 저장했습니다.
        </p>
      ) : null}
      {hasStaleDraftBase ? (
        <div className="space-y-3">
          <DraftConflictRecovery
            documentLabel="노트"
            onUseServer={() => {
              const latestServer = conflictServerRef.current ?? {
                snapshot: serverSnapshot,
                version: serverVersion,
              };
              restoredDraftRef.current = null;
              hideSaveConfirmation();
              clear();
              adoptSavedSnapshot(latestServer.snapshot);
              setBaseRevision(latestServer.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setTitle(latestServer.snapshot.title);
              setNoteDate(latestServer.snapshot.noteDate);
              setContentHtml(latestServer.snapshot.contentHtml);
              conflictServerRef.current = null;
              setHasStaleDraftBase(false);
            }}
            onKeepDraft={() => {
              const latestServer = conflictServerRef.current ?? {
                snapshot: serverSnapshot,
                version: serverVersion,
              };
              hideSaveConfirmation();
              adoptSavedSnapshot(latestServer.snapshot);
              setBaseRevision(latestServer.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              conflictServerRef.current = null;
              setHasStaleDraftBase(false);
            }}
          />
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">
              서버 최신본 {conflictServerRef.current?.version ?? serverVersion}번 확인·복사
            </summary>
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="font-medium">
                {conflictServerRef.current?.snapshot.title ?? serverSnapshot.title}
              </p>
              <RichTextContent
                html={
                  conflictServerRef.current?.snapshot.contentHtml ??
                  serverSnapshot.contentHtml
                }
              />
            </div>
          </details>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="min-w-0 flex-1 space-y-1.5">
          <span className="text-sm font-medium">제목</span>
          <Input
            name="title"
            value={title}
            onChange={(event) => {
              if (submittedOperationIdRef.current === operationId) {
                submittedOperationIdRef.current = null;
                setOperationId(createCreationOperationId());
              }
              hideSaveConfirmation();
              setTitle(event.target.value);
            }}
            required
            maxLength={200}
            disabled={!loaded || isPending}
          />
        </label>
        <label className="space-y-1.5 sm:w-44">
          <span className="text-sm font-medium">날짜</span>
          <Input
            name="noteDate"
            type="date"
            value={noteDate}
            onChange={(event) => {
              if (submittedOperationIdRef.current === operationId) {
                submittedOperationIdRef.current = null;
                setOperationId(createCreationOperationId());
              }
              hideSaveConfirmation();
              setNoteDate(event.target.value);
            }}
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
            if (submittedOperationIdRef.current === operationId) {
              submittedOperationIdRef.current = null;
              setOperationId(createCreationOperationId());
            }
            hideSaveConfirmation();
            handleEditorDirty(reader);
            save({
              title,
              noteDate,
              operationId,
              baseRevision,
              ...createDocumentEditDraftMetadata(
                hasStaleDraftBase
                  ? draftBaseFingerprintRef.current
                  : baseFingerprintRef.current,
              ),
              get contentHtml() {
                return reader();
              },
            });
          }}
          placeholder="수업 내용, 연습 기록, 메모를 이어서 작성하세요..."
          minHeight="min(60dvh, 42rem)"
          disabled={isPending}
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
              disabled={isPending}
            />
          }
          saveShortcutLabel={canSubmit ? "변경 저장" : undefined}
        />
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            !loaded ||
            !canSubmit ||
            isPending ||
            hasStaleDraftBase ||
            !operationId ||
            !title.trim() ||
            isRichTextEmpty(contentHtml)
          }
          className="gap-2"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
