"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createQnaThread, type CreateThreadState } from "@/lib/actions/qna";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

type QnaDraft = {
  operationId?: string;
  title: string;
  contentHtml: string;
  attachmentUrl: string;
};

export function NewQnaForm({ actorId, returnTo }: { actorId: string; returnTo: string }) {
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [operationId, setOperationId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [state, formAction, isPending] = useActionState<CreateThreadState, FormData>(
    createQnaThread,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submittedDraftRef = useRef<QnaDraft | null>(null);
  const handledThreadIdRef = useRef<string | null>(null);
  const router = useRouter();
  const isFormBusy = isPending || isUploading;
  useBusyNavigationGuard(isFormBusy);

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
  } = useFormDraft<QnaDraft>(
    createDocumentDraftKey("qna-thread", actorId),
    (draft) => {
      setOperationId(
        parseCreationOperationId(draft.operationId) ?? createCreationOperationId(),
      );
      setTitle(draft.title ?? "");
      setContentHtml(draft.contentHtml ?? "");
      setAttachmentUrl(draft.attachmentUrl ?? "");
    },
    {
      onReset: () => {
        setOperationId(createCreationOperationId());
        setTitle("");
        setContentHtml("");
        setAttachmentUrl("");
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    if (!title && isRichTextEmpty(contentHtml) && !attachmentUrl) {
      clear();
      return;
    }
    if (!operationId) return;
    save({ operationId, title, contentHtml, attachmentUrl });
  }, [attachmentUrl, clear, contentHtml, loaded, operationId, save, title]);

  useEffect(() => {
    if (!state.thread?.id || handledThreadIdRef.current === state.thread.id) return;
    handledThreadIdRef.current = state.thread.id;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? {
        operationId,
        title,
        contentHtml,
        attachmentUrl,
      },
    });
    submittedDraftRef.current = null;
    router.replace(`/dashboard/qna/${state.thread.id}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [attachmentUrl, clear, contentHtml, operationId, returnTo, router, state.thread?.id, title]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link
          href={returnTo}
          aria-disabled={isFormBusy}
          tabIndex={isFormBusy ? -1 : undefined}
          className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ${
            isFormBusy ? "pointer-events-none opacity-50" : ""
          }`}
          onClick={(event) => {
            if (isFormBusy) event.preventDefault();
          }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Q&amp;A
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">새 질문 작성</h1>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="space-y-5"
        onSubmit={(event) => {
          if (isFormBusy) {
            event.preventDefault();
            return;
          }
          if (!operationId) {
            event.preventDefault();
            return;
          }
          const submittedDraft = { operationId, title, contentHtml, attachmentUrl };
          save(submittedDraft);
          flush();
          submittedDraftRef.current = submittedDraft;
        }}
      >
        <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
        <input type="hidden" name="contentHtml" value={contentHtml} />

        {state.error && (!state.operationConflict || hasOperationConflict) ? (
          <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        {hasOperationConflict && state.existingId ? (
          <CreationConflictActions
            existingHref={`/dashboard/qna/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
            existingLabel="기존 질문 열기"
            separateLabel="별도 질문으로 저장"
            onSeparate={() => setOperationId(createCreationOperationId())}
            disabled={isFormBusy}
          />
        ) : null}

        <label className="block space-y-1.5" htmlFor="qna-title">
          <span className="text-sm font-medium">
            제목 <span className="text-destructive">*</span>
          </span>
          <Input
            id="qna-title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="질문 제목을 입력하세요"
            required
            disabled={isPending}
          />
        </label>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </p>
          {loaded ? (
            <FullEditor
              initialContent={contentHtml}
              onChange={setContentHtml}
              placeholder="질문 내용을 자세히 작성하세요. 악보, 코드, 이미지 등을 첨부할 수 있습니다."
              disabled={isPending}
              ariaLabel="Q&A 질문 내용"
              footer={
                <DraftStatus
                  status={status}
                  savedAt={savedAt}
                  restored={restored}
                  recoveries={recoveries}
                  onRestoreRecovery={restoreRecovery}
                  onDiscardRecovery={discardRecovery}
                  disabled={isFormBusy}
                />
              }
              onSave={() => {
                if (!isFormBusy) formRef.current?.requestSubmit();
              }}
            />
          ) : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">첨부 파일</p>
          <AttachmentField
            value={attachmentUrl}
            onChange={setAttachmentUrl}
            disabled={isPending}
            onUploadingChange={setIsUploading}
          />
        </div>

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isFormBusy || !operationId || !title.trim() || isRichTextEmpty(contentHtml)}
            className="flex-1 gap-2"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {isUploading ? "업로드 완료 대기…" : isPending ? "등록 중…" : "질문 등록"}
          </Button>
          <Button variant="outline" asChild>
            <Link
              href={returnTo}
              aria-disabled={isFormBusy}
              tabIndex={isFormBusy ? -1 : undefined}
              className={isFormBusy ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                if (isFormBusy) event.preventDefault();
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
