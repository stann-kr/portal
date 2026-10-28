"use client";

import { useActionState, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
import { MIXSET_LINK_FIELD, normalizeMixsetLinkUrl } from "@/lib/community-mixset-media";

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
  /**
   * 링크로 올린 믹스셋 게시물의 현재 링크. 있으면 필수 링크 칸을 보이고 `mixsetLinkUrl`로 함께 저장한다.
   * 없으면(일반·오디오 게시물) 매체 칸 없이 예전과 같이 동작한다.
   */
  mixsetLinkUrl?: string | null;
};

/** `mixsetLinkUrl`은 링크 칸이 있는 수정 form의 초안에만 들어간다. */
type PostEditSnapshot = { title: string; contentHtml: string; mixsetLinkUrl?: string };
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
  mixsetLinkUrl: serverLinkProp,
}: PostEditFormProps) {
  const serverLinkUrl = serverLinkProp || "";
  const hasLinkField = serverLinkUrl !== "";
  const [title, setTitle] = useState(post.title);
  const [linkUrl, setLinkUrl] = useState(serverLinkUrl);
  const [linkError, setLinkError] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkFieldId = useId();
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
  const baseRef = useRef({ title: post.title, contentHtml: post.contentHtml, mixsetLinkUrl: serverLinkUrl });
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
      baseRef.current = {
        title: snapshot.title,
        contentHtml: snapshot.contentHtml,
        mixsetLinkUrl: snapshot.mixsetLinkUrl ?? "",
      };
      // 서버 기준 지문은 제목·본문만으로 만든다(서버 updatePostContent와 같은 입력). 링크 변경은 revision으로 충돌을 가린다.
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
    () => ({ title: post.title, contentHtml: post.contentHtml, version: post.version, mixsetLinkUrl: serverLinkUrl }),
    [post.contentHtml, post.title, post.version, serverLinkUrl],
  );
  /** 충돌 응답의 게시물을 이 form의 snapshot 모양으로 맞춘다. 링크 칸이 없으면 링크는 비교하지 않는다. */
  const toConflictSnapshot = useCallback(
    (latest: NonNullable<UpdatePostState["conflictPost"]>) => ({
      title: latest.title,
      contentHtml: latest.contentHtml,
      version: latest.version,
      mixsetLinkUrl: hasLinkField ? (latest.mediaUrl || serverLinkUrl) : "",
    }),
    [hasLinkField, serverLinkUrl],
  );
  /** 초안에 넣을 링크 칸. 링크 칸이 없는 form의 초안 모양은 예전과 같다. */
  const linkDraftField = useCallback(
    (value: string): Pick<PostEditSnapshot, "mixsetLinkUrl"> => (hasLinkField ? { mixsetLinkUrl: value } : {}),
    [hasLinkField],
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
        restoredDraft.contentHtml === snapshot.contentHtml &&
        (restoredDraft.mixsetLinkUrl ?? "") === (snapshot.mixsetLinkUrl ?? "")
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
        // 링크 칸이 없는 게시물이면 초안의 링크는 쓰지 않는다. 이전 초안에 링크가 없으면 현재 링크를 쓴다.
        mixsetLinkUrl: hasLinkField
          ? (typeof draft.mixsetLinkUrl === "string" ? draft.mixsetLinkUrl : serverSnapshot.mixsetLinkUrl)
          : "",
      };
      const draftMatchesCurrentServer =
        restoredSnapshot.title === serverSnapshot.title &&
        restoredSnapshot.contentHtml === serverSnapshot.contentHtml &&
        restoredSnapshot.mixsetLinkUrl === serverSnapshot.mixsetLinkUrl;
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
      setLinkUrl(restoredSnapshot.mixsetLinkUrl);
      setLinkError("");
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
        setLinkUrl(serverSnapshot.mixsetLinkUrl);
        setLinkError("");
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
      latestContentHtml === baseRef.current.contentHtml &&
      linkUrl === baseRef.current.mixsetLinkUrl;
    if (!hasStaleDraftBase && unchanged) {
      restoredDraftRef.current = null;
      clear();
      return;
    }
    save({
      title,
      ...linkDraftField(linkUrl),
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
  }, [baseRevision, clear, contentHtml, hasStaleDraftBase, linkDraftField, linkUrl, loaded, operationId, readLatestContentHtml, save, title]);

  useEffect(() => {
    if (!loaded) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      previousServer.title !== serverSnapshot.title ||
      previousServer.contentHtml !== serverSnapshot.contentHtml ||
      previousServer.mixsetLinkUrl !== serverSnapshot.mixsetLinkUrl ||
      previousServer.version !== serverSnapshot.version;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    if (serverSnapshot.version < Math.max(baseRevision, conflictPost?.version ?? 0)) return;
    // 서버 prop이 충돌 사본 이상으로 따라잡으면 편집기의 최신 본문(React state보다 앞설 수 있는 외부 값)과
    // 함께 한 번에 재조정한다. 렌더 중에는 편집기·ref를 읽을 수 없어 이 동기화는 effect에 남긴다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 편집기 본문과의 서버 snapshot 재조정
    setConflictPost(undefined);
    // React 표시값은 editor보다 최대 200ms 늦을 수 있으므로 충돌 판정은 최신 reader를 사용한다.
    const latestContentHtml = readLatestContentHtml();
    const localMatchesPrevious =
      title === previousServer.title &&
      latestContentHtml === previousServer.contentHtml &&
      linkUrl === previousServer.mixsetLinkUrl;
    const localMatchesCurrent =
      title === serverSnapshot.title &&
      latestContentHtml === serverSnapshot.contentHtml &&
      linkUrl === serverSnapshot.mixsetLinkUrl;

    if (localMatchesCurrent || (!hasStaleDraftBase && localMatchesPrevious)) {
      restoredDraftRef.current = null;
      clear();
      adoptBaseSnapshot(serverSnapshot);
      setBaseRevision(serverSnapshot.version);
      setOperationId(createCreationOperationId());
      draftBaseFingerprintRef.current = baseFingerprintRef.current;
      setTitle(serverSnapshot.title);
      setContentHtml(serverSnapshot.contentHtml);
      setLinkUrl(serverSnapshot.mixsetLinkUrl);
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
    linkUrl,
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
        ...linkDraftField(linkUrl),
        operationId,
        baseRevision,
        ...createDocumentEditDraftMetadata(baseFingerprintRef.current),
      },
      submittedAliases:
        submittedDraftAliasesRef.current ??
        createSubmittedDraftAliases({ title, contentHtml, ...linkDraftField(linkUrl) }),
    });
    submittedDraftRef.current = null;
    submittedDraftAliasesRef.current = null;
    restoredDraftRef.current = null;
    onSaved();
  }, [baseRevision, clear, contentHtml, createSubmittedDraftAliases, linkDraftField, linkUrl, onSaved, operationId, state.post, title]);

  const linkHintId = `${linkFieldId}-hint`;
  const linkErrorId = `${linkFieldId}-error`;
  const latestServerForDisplay = conflictPost ? toConflictSnapshot(conflictPost) : serverSnapshot;

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isPending}
      noValidate={hasLinkField || undefined}
      className="flex flex-col gap-5"
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
        if (hasLinkField) {
          const normalizedLink = normalizeMixsetLinkUrl(linkUrl);
          if (!normalizedLink.ok) {
            event.preventDefault();
            setLinkError(normalizedLink.error);
            linkInputRef.current?.focus();
            return;
          }
        }
        if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
        const submittedDraft: CompactPostEditDraft = {
          title,
          contentHtml: latestContentHtml,
          ...linkDraftField(linkUrl),
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
          ...linkDraftField(linkUrl),
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
        <p role="alert" className="rounded-lg border border-destructive-border bg-destructive-muted p-3 text-ui text-destructive">
          {state.error}
        </p>
      ) : null}
      {hasStaleDraftBase ? (
        <div className="flex flex-col gap-3">
          <DraftConflictRecovery
            documentLabel="게시물"
            onUseServer={() => {
              const latest = conflictPost ? toConflictSnapshot(conflictPost) : serverSnapshot;
              restoredDraftRef.current = null;
              clear();
              adoptBaseSnapshot(latest);
              setBaseRevision(latest.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setTitle(latest.title);
              setContentHtml(latest.contentHtml);
              setLinkUrl(latest.mixsetLinkUrl);
              setLinkError("");
              setConflictPost(undefined);
              setHasStaleDraftBase(false);
              formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
            }}
            onKeepDraft={() => {
              const latest = conflictPost ? toConflictSnapshot(conflictPost) : serverSnapshot;
              adoptBaseSnapshot(latest);
              setBaseRevision(latest.version);
              setOperationId(createCreationOperationId());
              draftBaseFingerprintRef.current = baseFingerprintRef.current;
              setConflictPost(undefined);
              setHasStaleDraftBase(false);
              formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
            }}
          />
          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-ui font-medium">
              서버 최신본 {conflictPost?.version ?? serverSnapshot.version}번 확인·복사
            </summary>
            <div className="mt-3 flex flex-col gap-2 border-t border-muted pt-3">
              <p className="font-medium">{latestServerForDisplay.title}</p>
              {hasLinkField ? (
                <p className="break-all text-ui text-secondary-foreground">
                  믹스셋 링크: {latestServerForDisplay.mixsetLinkUrl}
                </p>
              ) : null}
              <RichTextContent html={latestServerForDisplay.contentHtml} />
            </div>
          </details>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-body font-medium text-secondary-foreground md:text-ui" htmlFor="edit-post-title">
        <span>제목</span>
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
          className="h-12 px-3.5 font-normal md:h-10 md:px-3 md:text-md"
        />
      </label>

      {hasLinkField ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={linkFieldId} className="text-body font-medium text-secondary-foreground md:text-ui">
            믹스셋 링크 <span className="sr-only">필수</span>
          </label>
          <Input
            ref={linkInputRef}
            id={linkFieldId}
            name={MIXSET_LINK_FIELD}
            type="url"
            inputMode="url"
            autoComplete="off"
            required
            value={linkUrl}
            onChange={(event) => {
              setOperationId(createCreationOperationId());
              setLinkUrl(event.target.value);
              setLinkError("");
            }}
            onBlur={() => {
              const normalizedLink = normalizeMixsetLinkUrl(linkUrl);
              setLinkError(normalizedLink.ok ? "" : normalizedLink.error);
            }}
            disabled={!loaded || isPending}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? `${linkHintId} ${linkErrorId}` : linkHintId}
            className="h-12 px-3.5 font-normal md:h-10 md:px-3"
          />
          <p id={linkHintId} className="text-xs leading-[18px] text-muted-foreground md:leading-4">
            YouTube 영상·Shorts·라이브와 SoundCloud 트랙·세트 링크로 바꿀 수 있습니다.
          </p>
          {linkError ? (
            <p id={linkErrorId} role="alert" className="text-ui text-destructive">{linkError}</p>
          ) : null}
        </div>
      ) : null}

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
              ...linkDraftField(linkUrl),
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
          toolbar="none"
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

      <div className="flex justify-end gap-2 border-t border-muted pt-3 md:pt-2">
        <Button type="button" variant="outline" size="touch" onClick={onCancel} disabled={isPending || isEditorUploading} className="md:h-9 md:rounded-md md:px-3.5 md:text-ui">
          취소
        </Button>
        <Button
          type="submit"
          size="touch"
          disabled={isSubmitDisabled}
          className="flex-1 md:h-9 md:flex-none md:rounded-md md:px-4 md:text-ui"
        >
          {isEditorUploading ? "업로드 완료 대기…" : isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
