"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { RichTextContent } from "@/components/editor/RichTextContent";
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
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { POST_BASE_REVISION_FIELD, parsePostRevision } from "@/lib/post-continuity";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type PostEditFormProps = {
  post: { id: string; title: string; contentHtml: string; version: number };
  actorId: string;
  onCancel: () => void;
  onSaved: () => void;
  onBusyChange?: (isBusy: boolean) => void;
};

type PostEditSnapshot = { title: string; contentHtml: string };
type PostOperationDraftFields = { operationId?: string; baseRevision?: number };
type PostEditDraft = PostEditSnapshot & DocumentEditDraftBaseFields & PostOperationDraftFields;
type CompactPostEditDraft = PostEditSnapshot & CompactDocumentEditDraftMetadata & PostOperationDraftFields;

export function PostEditForm(props: PostEditFormProps) {
  return <PostEditFormContent key={`${props.actorId}:${props.post.id}`} {...props} />;
}

function PostEditFormContent({
  post,
  actorId,
  onCancel,
  onSaved,
  onBusyChange,
}: PostEditFormProps) {
  const [title, setTitle] = useState(post.title);
  // 본문 이미지가 올라가는 동안에는 제출하지 않는다. 편집기는 계속 쓸 수 있다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [baseRevision, setBaseRevision] = useState(post.version);
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
    async (previous, data) => {
      try {
        return await updatePostContent(post.id, previous, data);
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
      }
    },
    {},
  );
  useBusyNavigationGuard(isPending);
  useEffect(() => {
    onBusyChange?.(isPending || isEditorUploading);
  }, [isEditorUploading, isPending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const handledSavedPostRef = useRef<UpdatePostState["post"]>(undefined);
  const handledConflictPostRef = useRef<UpdatePostState["conflictPost"]>(undefined);
  const [conflictPost, setConflictPost] = useState<UpdatePostState["conflictPost"]>(undefined);
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
      baseRef.current = { title: snapshot.title, contentHtml: snapshot.contentHtml };
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
    () => ({ title: post.title, contentHtml: post.contentHtml, version: post.version }),
    [post.contentHtml, post.title, post.version],
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
      setOperationId(parseCreationOperationId(draft.operationId) ?? createCreationOperationId());
      setBaseRevision(parsePostRevision(draft.baseRevision) ?? post.version);
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
        setConflictPost(undefined);
        setOperationId(createCreationOperationId());
        setBaseRevision(post.version);
        adoptBaseSnapshot(serverSnapshot);
        draftBaseFingerprintRef.current = baseFingerprintRef.current;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );
  const isSubmitBlocked =
    !loaded || !canSubmit || isPending || isEditorUploading || hasStaleDraftBase || !operationId;
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
  }, [baseRevision, clear, contentHtml, hasStaleDraftBase, loaded, operationId, readLatestContentHtml, save, title]);

  useEffect(() => {
    if (!loaded) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      previousServer.title !== serverSnapshot.title ||
      previousServer.contentHtml !== serverSnapshot.contentHtml ||
      previousServer.version !== serverSnapshot.version;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    if (serverSnapshot.version < Math.max(baseRevision, conflictPost?.version ?? 0)) return;
    setConflictPost(undefined);
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
      setBaseRevision(serverSnapshot.version);
      setOperationId(createCreationOperationId());
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
    baseRevision,
    clear,
    conflictPost,
    hasStaleDraftBase,
    loaded,
    readLatestContentHtml,
    serverSnapshot,
    setContentHtml,
    title,
  ]);

  useEffect(() => {
    if (!state.conflictPost || handledConflictPostRef.current === state.conflictPost) return;
    handledConflictPostRef.current = state.conflictPost;
    setConflictPost(state.conflictPost);
    if (!hasStaleDraftBase) draftBaseFingerprintRef.current = baseFingerprintRef.current;
    setHasStaleDraftBase(true);
  }, [hasStaleDraftBase, state.conflictPost]);

  useEffect(() => {
    if (!state.post?.id || handledSavedPostRef.current === state.post) return;
    handledSavedPostRef.current = state.post;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        title,
        contentHtml,
        operationId,
        baseRevision,
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
  }, [baseRevision, clear, contentHtml, createSubmittedDraftAliases, onSaved, operationId, state.post, title]);

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      className="space-y-5"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (isSubmitBlocked) {
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
          operationId,
          baseRevision,
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
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <input type="hidden" name={POST_BASE_REVISION_FIELD} value={baseRevision} />
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
        <div className="space-y-3">
          <DraftConflictRecovery
            documentLabel="게시물"
            onUseServer={() => {
              const latest = conflictPost ?? serverSnapshot;
              restoredDraftRef.current = null;
              clear();
              adoptBaseSnapshot(latest);
              setBaseRevision(latest.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setTitle(latest.title);
              setContentHtml(latest.contentHtml);
              setConflictPost(undefined);
              setHasStaleDraftBase(false);
              formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
            }}
            onKeepDraft={() => {
              const latest = conflictPost ?? serverSnapshot;
              adoptBaseSnapshot(latest);
              setBaseRevision(latest.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setConflictPost(undefined);
              setHasStaleDraftBase(false);
              formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
            }}
          />
          <details className="rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">
              서버 최신본 {conflictPost?.version ?? serverSnapshot.version}번 확인·복사
            </summary>
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="font-medium">{conflictPost?.title ?? serverSnapshot.title}</p>
              <RichTextContent html={conflictPost?.contentHtml ?? serverSnapshot.contentHtml} />
            </div>
          </details>
        </div>
      ) : null}

      <label className="block space-y-1.5" htmlFor="edit-post-title">
        <span className="text-sm font-medium">제목</span>
        <Input
          id="edit-post-title"
          name="title"
          value={title}
          onChange={(event) => {
            setOperationId(createCreationOperationId());
            setTitle(event.target.value);
          }}
          required
          disabled={!loaded || isPending}
        />
      </label>

      {loaded ? (
        <FullEditor
          onUploadingChange={setIsEditorUploading}
          initialContent={contentHtml}
          contentVersion={contentVersion}
          onChange={handleEditorChange}
          onDirty={(reader) => {
            const nextOperationId = createCreationOperationId();
            setOperationId(nextOperationId);
            handleEditorDirty(reader);
            save({
              title,
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
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending || isEditorUploading}>
          취소
        </Button>
        <Button
          type="submit"
          disabled={isSubmitDisabled}
          className="gap-2"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isEditorUploading ? "업로드 완료 대기…" : isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
