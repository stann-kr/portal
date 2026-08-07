"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { isRichTextEmpty } from "@/lib/rich-text";
import { updatePostContent, type UpdatePostState } from "@/lib/actions/posts";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
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

type PostEditFormProps = {
  post: { id: string; title: string; contentHtml: string };
  actorId: string;
  onCancel: () => void;
  onSaved: () => void;
  onBusyChange?: (isBusy: boolean) => void;
};

type PostEditSnapshot = { title: string; contentHtml: string };
type PostEditDraft = PostEditSnapshot & DocumentEditDraftBaseFields;
type CompactPostEditDraft = PostEditSnapshot & CompactDocumentEditDraftMetadata;

export function PostEditForm({
  post,
  actorId,
  onCancel,
  onSaved,
  onBusyChange,
}: PostEditFormProps) {
  const [title, setTitle] = useState(post.title);
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent(post.contentHtml);
  const [hasStaleDraftBase, setHasStaleDraftBase] = useState(false);
  const [state, formAction, isPending] = useActionState<UpdatePostState, FormData>(
    updatePostContent.bind(null, post.id),
    {},
  );
  useBusyNavigationGuard(isPending);
  useEffect(() => {
    onBusyChange?.(isPending);
  }, [isPending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const handledSavedPostRef = useRef<UpdatePostState["post"]>(undefined);
  const submittedDraftRef = useRef<CompactPostEditDraft | null>(null);
  const submittedDraftAliasesRef = useRef<readonly PostEditDraft[] | null>(null);
  const restoredDraftRef = useRef<PostEditDraft | null>(null);
  const baseRef = useRef({ title: post.title, contentHtml: post.contentHtml });
  const [baseFingerprint, setBaseFingerprint] = useState(() =>
    createDocumentSnapshotFingerprint({
      kind: "community-post",
      id: post.id,
      title: post.title,
      contentHtml: post.contentHtml,
      noteDate: null,
    }),
  );
  const baseFingerprintRef = useRef(baseFingerprint);
  const draftBaseFingerprintRef = useRef(baseFingerprint);
  const adoptBaseSnapshot = useCallback(
    (snapshot: PostEditSnapshot) => {
      baseRef.current = snapshot;
      const fingerprint = createDocumentSnapshotFingerprint({
        kind: "community-post",
        id: post.id,
        title: snapshot.title,
        contentHtml: snapshot.contentHtml,
        noteDate: null,
      });
      baseFingerprintRef.current = fingerprint;
      setBaseFingerprint(fingerprint);
    },
    [post.id],
  );
  const serverSnapshot = useMemo(
    () => ({ title: post.title, contentHtml: post.contentHtml }),
    [post.contentHtml, post.title],
  );
  const previousServerSnapshotRef = useRef(serverSnapshot);
  const createSubmittedDraftAliases = useCallback(
    (snapshot: PostEditSnapshot): readonly PostEditDraft[] => {
      const aliases: PostEditDraft[] = [
        { ...snapshot },
        { ...snapshot, base: { ...baseRef.current } },
      ];
      const restoredDraft = restoredDraftRef.current;
      if (
        restoredDraft &&
        restoredDraft.title === snapshot.title &&
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
  } = useSyncedFormDraft<PostEditDraft>(
    createDocumentDraftKey("community-post", actorId, post.id),
    (draft) => {
      restoredDraftRef.current = draft;
      const restoredSnapshot = {
        title: draft.title ?? post.title,
        contentHtml: draft.contentHtml ?? post.contentHtml,
      };
      const draftMatchesCurrentServer =
        restoredSnapshot.title === serverSnapshot.title &&
        restoredSnapshot.contentHtml === serverSnapshot.contentHtml;
      const resolvedBase = resolveDocumentEditDraftBase(
        draft,
        {
          kind: "community-post",
          id: post.id,
          title: serverSnapshot.title,
          contentHtml: serverSnapshot.contentHtml,
          noteDate: null,
        },
        draftMatchesCurrentServer,
      );
      draftBaseFingerprintRef.current = resolvedBase.draftBaseFingerprint;
      setHasStaleDraftBase(resolvedBase.hasStaleDraftBase);
      if (!resolvedBase.hasStaleDraftBase) {
        adoptBaseSnapshot(serverSnapshot);
      }
      setTitle(restoredSnapshot.title);
      setContentHtml(restoredSnapshot.contentHtml);
    },
    {
      onReset: () => {
        restoredDraftRef.current = null;
        adoptBaseSnapshot(serverSnapshot);
        draftBaseFingerprintRef.current = baseFingerprintRef.current;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );
  const isSubmitBlocked = !loaded || !canSubmit || isPending || hasStaleDraftBase;
  const isSubmitDisabled =
    isSubmitBlocked ||
    !title.trim() ||
    isRichTextEmpty(contentHtml);
  const handleSaveShortcut = useDocumentSaveShortcut({
    disabled: isSubmitBlocked,
    onSave: () => formRef.current?.requestSubmit(),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const unchanged =
      title === baseRef.current.title &&
      latestContentHtml === baseRef.current.contentHtml;
    if (!hasStaleDraftBase && unchanged) {
      restoredDraftRef.current = null;
      clear();
      return;
    }
    save({
      title,
      ...createDocumentEditDraftMetadata(
        hasStaleDraftBase
          ? draftBaseFingerprintRef.current
          : baseFingerprintRef.current,
      ),
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [clear, contentHtml, hasStaleDraftBase, loaded, readLatestContentHtml, save, title]);

  useEffect(() => {
    if (!loaded) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      previousServer.title !== serverSnapshot.title ||
      previousServer.contentHtml !== serverSnapshot.contentHtml;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    // React 표시값은 editor보다 최대 200ms 늦을 수 있으므로 충돌 판정은 최신 reader를 사용한다.
    const latestContentHtml = readLatestContentHtml();
    const localMatchesPrevious =
      title === previousServer.title &&
      latestContentHtml === previousServer.contentHtml;
    const localMatchesCurrent =
      title === serverSnapshot.title &&
      latestContentHtml === serverSnapshot.contentHtml;

    if (localMatchesCurrent || (!hasStaleDraftBase && localMatchesPrevious)) {
      restoredDraftRef.current = null;
      clear();
      adoptBaseSnapshot(serverSnapshot);
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
      setTitle(serverSnapshot.title);
      setContentHtml(serverSnapshot.contentHtml);
      setHasStaleDraftBase(false);
      return;
    }

    if (!hasStaleDraftBase) {
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
    }
    setHasStaleDraftBase(true);
  }, [
    adoptBaseSnapshot,
    clear,
    hasStaleDraftBase,
    loaded,
    readLatestContentHtml,
    serverSnapshot,
    setContentHtml,
    title,
  ]);

  useEffect(() => {
    if (!state.post?.id || handledSavedPostRef.current === state.post) return;
    handledSavedPostRef.current = state.post;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        title,
        contentHtml,
        ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
      },
      submittedAliases:
        submittedDraftAliasesRef.current ??
        createSubmittedDraftAliases({ title, contentHtml }),
    });
    submittedDraftRef.current = null;
    submittedDraftAliasesRef.current = null;
    restoredDraftRef.current = null;
    onSaved();
  }, [clear, contentHtml, createSubmittedDraftAliases, onSaved, state.post, title]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      className="space-y-5"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || !canSubmit || isPending || hasStaleDraftBase) {
          event.preventDefault();
          return;
        }
        const latestContentHtml = commitLatestContentHtml();
        if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
          event.preventDefault();
          return;
        }
        if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
        const submittedDraft: CompactPostEditDraft = {
          title,
          contentHtml: latestContentHtml,
          ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
        };
        save(submittedDraft);
        flush();
        submittedDraftRef.current = submittedDraft;
        submittedDraftAliasesRef.current = createSubmittedDraftAliases({
          title,
          contentHtml: latestContentHtml,
        });
      }}
    >
      <input ref={contentInputRef} type="hidden" name="contentHtml" value={contentHtml} />
      <input
        type="hidden"
        name={DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD}
        value={baseFingerprint}
      />

      {state.error ? (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {hasStaleDraftBase ? (
        <DraftConflictRecovery
          documentLabel="게시물"
          onUseServer={() => {
            restoredDraftRef.current = null;
            clear();
            adoptBaseSnapshot(serverSnapshot);
            draftBaseFingerprintRef.current = baseFingerprintRef.current;
            setTitle(serverSnapshot.title);
            setContentHtml(serverSnapshot.contentHtml);
            setHasStaleDraftBase(false);
          }}
          onKeepDraft={() => {
            adoptBaseSnapshot(serverSnapshot);
            draftBaseFingerprintRef.current = baseFingerprintRef.current;
            setHasStaleDraftBase(false);
          }}
        />
      ) : null}

      <label className="block space-y-1.5" htmlFor="edit-post-title">
        <span className="text-sm font-medium">제목</span>
        <Input
          id="edit-post-title"
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          disabled={!loaded || isPending}
        />
      </label>

      {loaded ? (
        <FullEditor
          initialContent={contentHtml}
          contentVersion={contentVersion}
          onChange={handleEditorChange}
          onDirty={(reader) => {
            handleEditorDirty(reader);
            save({
              title,
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
          minHeight="min(60dvh, 42rem)"
          placeholder="게시물 내용을 이어서 작성하세요…"
          ariaLabel="커뮤니티 게시물 내용"
          disabled={isPending}
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
          saveShortcutLabel={canSubmit ? "변경 저장" : undefined}
        />
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          취소
        </Button>
        <Button
          type="submit"
          disabled={isSubmitDisabled}
          className="gap-2"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
