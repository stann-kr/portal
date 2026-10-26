"use client";

import { useActionState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AutosaveStatus } from "@/components/editor/AutosaveStatus";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import type { UpdateNoteState } from "@/lib/actions/privateNotes";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentAutosave } from "@/lib/hooks/useDocumentAutosave";
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
  /** 새 노트를 만든 직후처럼 본문 끝에서 바로 이어 쓰게 한다. */
  focusBodyEnd?: boolean;
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

/** 서버는 제목 앞뒤 공백을 지운다. 입력 중인 띄어쓰기를 저장 차이로 보지 않는다. */
function sameSnapshot(a: NoteEditSnapshot, b: NoteEditSnapshot): boolean {
  return a.title.trim() === b.title.trim() && a.noteDate === b.noteDate && a.contentHtml === b.contentHtml;
}

export function NoteEditorForm(props: NoteEditorFormProps) {
  return <NoteEditorFormContent key={`${props.actorId}:${props.note.id}`} {...props} />;
}

function NoteEditorFormContent({ note, actorId, action, focusBodyEnd = false }: NoteEditorFormProps) {
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
  const [state, formAction, isPending] = useActionState<UpdateNoteState, FormData>(async (previous, data) => {
    try {
      return await action(previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
    }
  }, {});
  useBusyNavigationGuard(isPending);
  // 본문 이미지가 올라가는 동안에는 이미지 없는 본문을 저장하지 않는다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const contentHtmlInputRef = useRef<HTMLInputElement>(null);
  const handledSavedNoteRef = useRef<UpdateNoteState["note"]>(undefined);
  const handledConflictNoteRef = useRef<UpdateNoteState["conflictNote"]>(undefined);
  const [conflictServer, setConflictServer] = useState<ConflictServerState | null>(null);
  const submittedDraftRef = useRef<CompactNoteEditDraft | null>(null);
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
      savedSnapshotRef.current = { title: snapshot.title, contentHtml: snapshot.contentHtml, noteDate: snapshot.noteDate };
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
      version: serverVersion,
    }),
    [note.contentHtml, note.noteDate, note.title, serverVersion],
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
      previousServer.contentHtml !== serverSnapshot.contentHtml ||
      previousServer.version !== serverSnapshot.version;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    if (serverVersion < Math.max(baseRevision, conflictServer?.version ?? 0)) return;
    // 방금 자동 저장한 내용이 화면 갱신으로 돌아온 것이면 이어서 쓴 내용과의 충돌이 아니다.
    const submitted = submittedDraftRef.current;
    const ownSave =
      (submitted && sameSnapshot(submitted, serverSnapshot)) ||
      (state.success && state.note && sameSnapshot({
        title: state.note.title,
        noteDate: toDateInputValue(state.note.noteDate),
        contentHtml: state.note.contentHtml,
      }, serverSnapshot));
    if (ownSave) return;
    setConflictServer(null);
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
    baseRevision,
    clear,
    conflictServer,
    hasStaleDraftBase,
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
    setConflictServer({
      snapshot: {
        title: state.conflictNote.title,
        noteDate: toDateInputValue(state.conflictNote.noteDate),
        contentHtml: state.conflictNote.contentHtml,
      },
      version: state.conflictNote.version,
    });
    if (!hasStaleDraftBase) {
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
    }
    setHasStaleDraftBase(true);
  }, [hasStaleDraftBase, state.conflictNote]);

  useEffect(() => {
    if (
      !state.success ||
      !state.note?.id ||
      handledSavedNoteRef.current === state.note
    ) {
      return;
    }
    handledSavedNoteRef.current = state.note;
    const submittedSnapshot = submittedDraftRef.current;
    const latestContentHtml = readLatestContentHtml();
    // 저장 요청 뒤에도 계속 썼다면 그 내용을 지키고 다음 자동 저장에 맡긴다.
    const typedSinceSubmit = Boolean(
      submittedSnapshot &&
        !sameSnapshot(submittedSnapshot, { title, noteDate, contentHtml: latestContentHtml }),
    );
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
    submittedDraftAliasesRef.current = null;
    restoredDraftRef.current = null;
    setConflictServer(null);
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
    if (!typedSinceSubmit) {
      if (title.trim() !== state.note.title) setTitle(state.note.title);
      setNoteDate(toDateInputValue(state.note.noteDate));
      // 서버가 정리한 HTML이 다를 때만 편집기를 다시 채운다. 같으면 커서를 건드리지 않는다.
      if (latestContentHtml !== state.note.contentHtml) setContentHtml(state.note.contentHtml);
    }
  }, [
    adoptSavedSnapshot,
    clear,
    contentHtml,
    createSubmittedDraftAliases,
    noteDate,
    readLatestContentHtml,
    setContentHtml,
    state.currentRevision,
    state.note,
    state.success,
    title,
  ]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusedBodyRef = useRef(false);
  useEffect(() => {
    if (!focusBodyEnd || !loaded || focusedBodyRef.current) return;
    // 편집기는 지연 로드되므로 나타날 때까지 짧게 기다린다.
    let attempts = 0;
    const timer = window.setInterval(() => {
      const body = formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      attempts += 1;
      if (!body && attempts < 40) return;
      window.clearInterval(timer);
      if (!body) return;
      focusedBodyRef.current = true;
      body.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const url = new URL(window.location.href);
      url.searchParams.delete("focus");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }, 50);
    return () => window.clearInterval(timer);
  }, [focusBodyEnd, loaded]);
  // 긴 제목도 잘리지 않게 내용 높이에 맞춘다(field-sizing을 지원하지 않는 브라우저 포함).
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [title]);
  const savedSnapshot = savedSnapshotRef.current;
  const dirty = loaded && !sameSnapshot(savedSnapshot, { title, noteDate, contentHtml });
  const changeKey = `${title}\u0000${noteDate}\u0000${contentHtml}`;
  const submittedKeyRef = useRef("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (state.error) setFailedKey(submittedKeyRef.current);
    else if (state.success) setFailedKey(null);
  }, [state]);
  const missingRequired = !title.trim() || isRichTextEmpty(contentHtml);
  const autosaveReady =
    loaded && canSubmit && !isPending && !hasStaleDraftBase && Boolean(operationId) && !missingRequired;
  useDocumentAutosave({
    enabled: autosaveReady && failedKey !== changeKey && !isEditorUploading,
    dirty,
    changeKey,
    onSave: () => formRef.current?.requestSubmit(),
  });
  const autosaveStatus = isPending
    ? "saving"
    : hasStaleDraftBase
      ? "blocked"
      : state.error && failedKey === changeKey
        ? "error"
        : dirty
          ? missingRequired ? "blocked" : "pending"
          : "saved";

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
          isEditorUploading ||
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
        submittedKeyRef.current = `${title}\u0000${noteDate}\u0000${latestContentHtml}`;
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

      <div className="flex justify-end">
        <AutosaveStatus
          status={autosaveStatus}
          message={
            autosaveStatus === "error"
              ? state.error
              : hasStaleDraftBase
                ? "다른 곳의 변경을 확인할 때까지 저장을 멈췄습니다."
                : "제목과 내용을 입력하면 자동으로 저장됩니다."
          }
          onRetry={() => formRef.current?.requestSubmit()}
        />
      </div>

      {hasStaleDraftBase ? (
        <div className="space-y-3">
          <DraftConflictRecovery
            documentLabel="노트"
            onUseServer={() => {
              const latestServer = conflictServer ?? {
                snapshot: serverSnapshot,
                version: serverVersion,
              };
              restoredDraftRef.current = null;
              clear();
              adoptSavedSnapshot(latestServer.snapshot);
              setBaseRevision(latestServer.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setTitle(latestServer.snapshot.title);
              setNoteDate(latestServer.snapshot.noteDate);
              setContentHtml(latestServer.snapshot.contentHtml);
              setConflictServer(null);
              setHasStaleDraftBase(false);
              formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name="title"]')?.focus();
            }}
            onKeepDraft={() => {
              const latestServer = conflictServer ?? {
                snapshot: serverSnapshot,
                version: serverVersion,
              };
              adoptSavedSnapshot(latestServer.snapshot);
              setBaseRevision(latestServer.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setConflictServer(null);
              setHasStaleDraftBase(false);
              formRef.current?.querySelector<HTMLTextAreaElement>('textarea[name="title"]')?.focus();
            }}
          />
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">
              서버 최신본 {conflictServer?.version ?? serverVersion}번 확인·복사
            </summary>
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="font-medium">
                {conflictServer?.snapshot.title ?? serverSnapshot.title}
              </p>
              <RichTextContent
                html={
                  conflictServer?.snapshot.contentHtml ??
                  serverSnapshot.contentHtml
                }
              />
            </div>
          </details>
        </div>
      ) : null}

      <div className="space-y-2">
        <h1 className="sr-only">노트 편집</h1>
        <textarea
          ref={titleRef}
          name="title"
          aria-label="제목"
          value={title}
          rows={1}
          onChange={(event) => {
            setOperationId(createCreationOperationId());
            setTitle(event.target.value.replace(/\n/gu, " "));
          }}
          onKeyDown={(event) => {
            // 제목에서 Enter는 줄바꿈 대신 본문으로 이동한다.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
          }}
          required
          maxLength={200}
          placeholder="제목 없음"
          disabled={!loaded}
          className="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-3xl font-bold leading-tight tracking-[-0.02em] text-foreground placeholder:text-muted-foreground/60 focus:outline-none sm:text-4xl"
        />
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span>날짜</span>
          <input
            name="noteDate"
            type="date"
            value={noteDate}
            onChange={(event) => {
              setOperationId(createCreationOperationId());
              setNoteDate(event.target.value);
            }}
            disabled={!loaded}
            className="rounded-md bg-transparent px-1.5 py-0.5 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      {loaded ? (
        <FullEditor
          initialContent={contentHtml}
          contentVersion={contentVersion}
          onUploadingChange={setIsEditorUploading}
          onChange={handleEditorChange}
          onDirty={(reader) => {
            const nextOperationId = createCreationOperationId();
            setOperationId(nextOperationId);
            handleEditorDirty(reader);
            save({
              title,
              noteDate,
              operationId: nextOperationId,
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
          minHeight="50dvh"
          ariaLabel="노트 내용"
          variant="page"
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
              quiet
            />
          }
          saveShortcutLabel={canSubmit ? "바로 저장" : undefined}
        />
      ) : null}

    </form>
  );
}
