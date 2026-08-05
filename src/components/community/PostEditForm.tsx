"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { DraftConflictRecovery } from "@/components/editor/DraftConflictRecovery";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { updatePostContent, type UpdatePostState } from "@/lib/actions/posts";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

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

export function PostEditForm({
  post,
  actorId,
  onCancel,
  onSaved,
  onBusyChange,
}: PostEditFormProps) {
  const [title, setTitle] = useState(post.title);
  const [contentHtml, setContentHtml] = useState(post.contentHtml);
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
  const handledSavedPostRef = useRef<UpdatePostState["post"]>(undefined);
  const submittedDraftRef = useRef<{
    title: string;
    contentHtml: string;
    base: { title: string; contentHtml: string };
  } | null>(null);
  const baseRef = useRef({ title: post.title, contentHtml: post.contentHtml });
  const draftBaseRef = useRef({ title: post.title, contentHtml: post.contentHtml });
  const serverSnapshot = useMemo(
    () => ({ title: post.title, contentHtml: post.contentHtml }),
    [post.contentHtml, post.title],
  );
  const previousServerSnapshotRef = useRef(serverSnapshot);

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
  } = useFormDraft<{
    title: string;
    contentHtml: string;
    base?: { title: string; contentHtml: string };
  }>(
    createDocumentDraftKey("community-post", actorId, post.id),
    (draft) => {
      draftBaseRef.current = serverSnapshot;
      setHasStaleDraftBase(false);
      if (
        draft.base &&
        typeof draft.base.title === "string" &&
        typeof draft.base.contentHtml === "string"
      ) {
        draftBaseRef.current = draft.base;
        const matchesCurrentServer =
          draft.base.title === serverSnapshot.title &&
          draft.base.contentHtml === serverSnapshot.contentHtml;
        if (matchesCurrentServer) baseRef.current = draft.base;
        setHasStaleDraftBase(!matchesCurrentServer);
      }
      setTitle(draft.title ?? post.title);
      setContentHtml(draft.contentHtml ?? post.contentHtml);
    },
    {
      onReset: () => {
        baseRef.current = serverSnapshot;
        draftBaseRef.current = serverSnapshot;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    const unchanged = title === baseRef.current.title && contentHtml === baseRef.current.contentHtml;
    if (!hasStaleDraftBase && unchanged) {
      clear();
      return;
    }
    save({
      title,
      contentHtml,
      base: hasStaleDraftBase ? draftBaseRef.current : baseRef.current,
    });
  }, [clear, contentHtml, hasStaleDraftBase, loaded, save, title]);

  useEffect(() => {
    if (!loaded) return;
    const previousServer = previousServerSnapshotRef.current;
    const serverChanged =
      previousServer.title !== serverSnapshot.title ||
      previousServer.contentHtml !== serverSnapshot.contentHtml;
    if (!serverChanged) return;

    previousServerSnapshotRef.current = serverSnapshot;
    const localMatchesPrevious =
      title === previousServer.title && contentHtml === previousServer.contentHtml;
    const localMatchesCurrent =
      title === serverSnapshot.title && contentHtml === serverSnapshot.contentHtml;

    if (localMatchesCurrent || (!hasStaleDraftBase && localMatchesPrevious)) {
      clear();
      baseRef.current = serverSnapshot;
      draftBaseRef.current = serverSnapshot;
      setTitle(serverSnapshot.title);
      setContentHtml(serverSnapshot.contentHtml);
      setHasStaleDraftBase(false);
      return;
    }

    if (!hasStaleDraftBase) draftBaseRef.current = baseRef.current;
    setHasStaleDraftBase(true);
  }, [clear, contentHtml, hasStaleDraftBase, loaded, serverSnapshot, title]);

  useEffect(() => {
    if (!state.post?.id || handledSavedPostRef.current === state.post) return;
    handledSavedPostRef.current = state.post;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        title,
        contentHtml,
        base: baseRef.current,
      },
    });
    submittedDraftRef.current = null;
    onSaved();
  }, [clear, contentHtml, onSaved, state.post, title]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-5"
      onSubmit={() => {
        submittedDraftRef.current = {
          title,
          contentHtml,
          base: { ...baseRef.current },
        };
      }}
    >
      <input type="hidden" name="contentHtml" value={contentHtml} />
      <input type="hidden" name="baseTitle" value={baseRef.current.title} />
      <input type="hidden" name="baseContentHtml" value={baseRef.current.contentHtml} />

      {state.error ? (
        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {hasStaleDraftBase ? (
        <DraftConflictRecovery
          documentLabel="게시물"
          onUseServer={() => {
            clear();
            baseRef.current = serverSnapshot;
            draftBaseRef.current = serverSnapshot;
            setTitle(serverSnapshot.title);
            setContentHtml(serverSnapshot.contentHtml);
            setHasStaleDraftBase(false);
          }}
          onKeepDraft={() => {
            baseRef.current = serverSnapshot;
            draftBaseRef.current = serverSnapshot;
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
          disabled={isPending}
        />
      </label>

      {loaded ? (
        <FullEditor
          initialContent={contentHtml}
          onChange={setContentHtml}
          minHeight="min(60dvh, 42rem)"
          placeholder="게시물 내용을 이어서 작성하세요…"
          ariaLabel="커뮤니티 게시물 내용"
          disabled={isPending}
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
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          취소
        </Button>
        <Button
          type="submit"
          disabled={isPending || hasStaleDraftBase || !title.trim() || isRichTextEmpty(contentHtml)}
          className="gap-2"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isPending ? "저장 중…" : "변경사항 저장"}
        </Button>
      </div>
    </form>
  );
}
