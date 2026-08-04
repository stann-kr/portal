"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type PostEditFormProps = {
  post: { id: string; title: string; contentHtml: string };
  actorId: string;
  onCancel: () => void;
  onSaved: () => void;
};

export function PostEditForm({ post, actorId, onCancel, onSaved }: PostEditFormProps) {
  const [title, setTitle] = useState(post.title);
  const [contentHtml, setContentHtml] = useState(post.contentHtml);
  const [hasStaleDraftBase, setHasStaleDraftBase] = useState(false);
  const [state, formAction, isPending] = useActionState<UpdatePostState, FormData>(
    updatePostContent.bind(null, post.id),
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const baseRef = useRef({ title: post.title, contentHtml: post.contentHtml });
  const serverSnapshot = { title: post.title, contentHtml: post.contentHtml };

  const { loaded, save, clear, status, savedAt, restored } = useFormDraft<{
    title: string;
    contentHtml: string;
    base?: { title: string; contentHtml: string };
  }>(
    createDocumentDraftKey("community-post", actorId, post.id),
    (draft) => {
      if (
        draft.base &&
        typeof draft.base.title === "string" &&
        typeof draft.base.contentHtml === "string"
      ) {
        const matchesCurrentServer =
          draft.base.title === serverSnapshot.title &&
          draft.base.contentHtml === serverSnapshot.contentHtml;
        if (matchesCurrentServer) baseRef.current = draft.base;
        else setHasStaleDraftBase(true);
      }
      setTitle(draft.title ?? post.title);
      setContentHtml(draft.contentHtml ?? post.contentHtml);
    },
    {
      onReset: () => {
        baseRef.current = serverSnapshot;
        setHasStaleDraftBase(false);
        setTitle(serverSnapshot.title);
        setContentHtml(serverSnapshot.contentHtml);
      },
    },
  );

  useEffect(() => {
    if (!loaded || hasStaleDraftBase) return;
    const unchanged = title === baseRef.current.title && contentHtml === baseRef.current.contentHtml;
    if (unchanged) {
      clear();
      return;
    }
    save({ title, contentHtml, base: baseRef.current });
  }, [clear, contentHtml, hasStaleDraftBase, loaded, save, title]);

  useEffect(() => {
    if (!state.post?.id) return;
    clear();
    onSaved();
  }, [clear, onSaved, state.post?.id]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
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
            setTitle(serverSnapshot.title);
            setContentHtml(serverSnapshot.contentHtml);
            setHasStaleDraftBase(false);
          }}
          onKeepDraft={() => {
            baseRef.current = serverSnapshot;
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
          footer={<DraftStatus status={status} savedAt={savedAt} restored={restored} />}
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
