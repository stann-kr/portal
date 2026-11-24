/**
 * @file src/components/qna/QnaReplyEditForm.tsx
 * @description 이미 올린 내 질문·답글을 그 자리에서 고치는 칸(감사 보완 #7). 작성자 본인만 연다.
 * 다른 Q&A 글쓰기와 같이 공동 편집 작성본(room `draft:qna-reply-edit:<본인>:<답글>`)에 두어 기기 사이에 이어지고
 * 오프라인에도 이 기기에 남는다. room `meta`의 `baseHtml`은 고치기 시작할 때 본 본문이라, 서버는 그 본문이 지금 본문과
 * 같을 때만 바꾼다(다른 기기에서 먼저 고쳤으면 덮지 않는다). 저장하면 기준을 저장한 본문으로 맞추고,
 * "취소"는 room을 기준 본문으로 되돌린다. Esc는 칸만 닫고 고치던 내용을 남긴다(다시 열면 이어진다).
 */
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CollabEditorPending } from "@/components/editor/CollabEditorPending";
import { useEditorExtensions } from "@/components/editor/useEditorExtensions";
import { editQnaReply } from "@/lib/actions/qna";
import { canonicalCollabHtml, replaceCollabDocHtml } from "@/lib/collab/client/doc-html";
import { describeCollabStatus, isCollabEditorPending } from "@/lib/collab/client/collab-status";
import { useCollabFormDraft } from "@/lib/collab/client/useCollabFormDraft";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { isRichTextEmpty } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false, loading: () => <CollabEditorPending variant="bare" /> },
);

export function QnaReplyEditForm({
  actorId,
  reply,
  label,
  onClose,
}: {
  actorId: string;
  reply: { id: string; contentHtml: string };
  /** 화면 읽기용 이름(예: "내 질문", "내 답변"). */
  label: string;
  onClose: () => void;
}) {
  const getExtensions = useEditorExtensions();
  const fields = useMemo(() => ({ baseHtml: reply.contentHtml }), [reply.contentHtml]);
  const draft = useCollabFormDraft({
    ownerId: actorId,
    room: { draftKind: "qna-reply-edit", ownerId: actorId, scope: reply.id },
    fields,
    seedHtml: reply.contentHtml,
    extensions: getExtensions,
  });
  const loaded = draft.ready && draft.collab.mode === "write";
  const baseHtml = draft.fields.baseHtml;
  const [error, setError] = useState<string | null>(null);
  const [conflictHtml, setConflictHtml] = useState<string | null>(null);
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useBusyNavigationGuard(isPending);

  // 지난번에 고치다 만 내용 없이 기준만 옛 본문이면(다른 기기에서 저장한 뒤 room이 뒤처진 경우) 지금 본문으로 맞춘다.
  const alignedRef = useRef(false);
  useEffect(() => {
    const doc = draft.collab.doc;
    if (!loaded || !doc || alignedRef.current) return;
    alignedRef.current = true;
    if (baseHtml === reply.contentHtml) return;
    const extensions = getExtensions();
    const untouched = canonicalCollabHtml(baseHtml, extensions) === canonicalCollabHtml(draft.readHtml(), extensions);
    if (untouched) replaceCollabDocHtml(doc, reply.contentHtml, extensions, { baseHtml: reply.contentHtml });
  }, [baseHtml, draft, getExtensions, loaded, reply.contentHtml]);

  const dirty = loaded && (() => {
    const extensions = getExtensions();
    return canonicalCollabHtml(baseHtml, extensions) !== canonicalCollabHtml(draft.contentHtml, extensions);
  })();

  // 편집기가 준비되면 한 번 글 끝에 초점을 둔다(고치기 버튼을 누른 흐름을 이어 간다).
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!loaded || focusedRef.current) return;
    const editable = formRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!editable) return;
    focusedRef.current = true;
    editable.focus();
    const selection = window.getSelection();
    selection?.selectAllChildren(editable);
    selection?.collapseToEnd();
  });

  const resetTo = (html: string) => {
    const doc = draft.collab.doc;
    if (doc) replaceCollabDocHtml(doc, html, getExtensions(), { baseHtml: html });
  };

  const cancel = () => {
    // 고치던 내용을 모든 기기에서 버리고 기준 본문으로 되돌린다.
    resetTo(baseHtml);
    onClose();
  };

  const submit = () => {
    if (isPending || !loaded || isEditorUploading) return;
    const contentHtml = draft.readHtml();
    if (isRichTextEmpty(contentHtml)) {
      setError("내용을 입력해 주세요.");
      return;
    }
    setError(null);
    setConflictHtml(null);
    startTransition(async () => {
      try {
        const result = await editQnaReply(reply.id, { expectedHtml: baseHtml, contentHtml });
        if (!result.ok) {
          setError(result.error);
          if (result.currentHtml !== undefined) setConflictHtml(result.currentHtml);
          return;
        }
        // 저장한 본문을 새 기준으로 둔다(다음 고치기는 여기서 시작한다).
        resetTo(result.contentHtml);
        onClose();
        router.refresh();
      } catch {
        setError(`${label}을 고치지 못했습니다. 다시 시도해 주세요.`);
      }
    });
  };

  const status = describeCollabStatus({
    connection: draft.collab.status,
    mode: draft.collab.mode,
    isSaver: false,
    autosave: "idle",
    autosaveError: null,
    blockedMessage: "",
    manual: true,
  });

  return (
    <form
      ref={formRef}
      aria-label={`${label} 고치기`}
      aria-busy={!loaded || isPending}
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isPending || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div
        className={cn(
          "flex min-h-[96px] flex-col rounded-touch border border-border bg-background transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring motion-reduce:transition-none",
        )}
      >
        {!isCollabEditorPending(draft.collab) && draft.collaboration ? (
          <FullEditor
            collaboration={draft.collaboration}
            onUploadingChange={setIsEditorUploading}
            variant="bare"
            toolbar="none"
            contentClassName="px-3 py-2.5 text-base leading-[22px] md:px-4 md:py-3 md:text-md md:leading-6"
            disabled={!loaded || isPending}
            ariaLabel={`${label} 내용`}
          />
        ) : (
          <CollabEditorPending collab={draft.collab} variant="bare" />
        )}
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-ui text-destructive">
          <span>{error}</span>
          {conflictHtml !== null ? (
            <button
              type="button"
              onClick={() => {
                resetTo(conflictHtml);
                setConflictHtml(null);
                setError(null);
                router.refresh();
              }}
              className="h-11 rounded-sm px-1 text-ui text-foreground underline underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8"
            >
              지금 내용으로 다시 고치기
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" title={status.message}>
          {status.shortMessage}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={isPending} className="max-md:h-11">취소</Button>
          <Button
            type="submit"
            size="sm"
            pending={isPending}
            disabled={!loaded || !dirty || isEditorUploading}
            className="max-md:h-11"
          >
            저장
          </Button>
        </div>
      </div>
    </form>
  );
}
