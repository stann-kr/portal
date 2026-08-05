/**
 * @file src/components/qna/QnaSlideForm.tsx
 * @description SlidePanel 내 Q&A 인라인 작성 폼.
 * 저장 성공 시 `onSuccess(newItem)` 콜백으로 낙관적 업데이트 트리거.
 * 첨부 파일 업로드 + 임시저장(draft) 자동 복원 지원.
 */
"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { createQnaThreadInline, type CreateThreadInlineState } from "@/lib/actions/qna";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useRouter } from "next/navigation";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false },
);

interface QnaDraft {
  title: string;
  contentHtml: string;
  attachmentUrl: string;
}

interface QnaSlideFormProps {
  actorId: string;
  onSuccess: (item: UnifiedItem) => void;
  onClose: () => void;
  returnTo: string;
  onBusyChange?: (isBusy: boolean) => void;
}

export function QnaSlideForm({
  actorId,
  onSuccess,
  onClose,
  returnTo,
  onBusyChange,
}: QnaSlideFormProps) {
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [state, formAction, isPending] = useActionState<CreateThreadInlineState, FormData>(
    createQnaThreadInline,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submittedDraftRef = useRef<QnaDraft | null>(null);
  const handledThreadIdRef = useRef<string | null>(null);
  const router = useRouter();
  const isFormBusy = isPending || isUploading;
  useBusyNavigationGuard(isFormBusy);

  useEffect(() => {
    onBusyChange?.(isFormBusy);
  }, [isFormBusy, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 임시저장 복원/저장
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
  } = useFormDraft<QnaDraft>(
    createDocumentDraftKey("qna-thread", actorId),
    (d) => {
      setTitle(d.title ?? "");
      setContentHtml(d.contentHtml ?? "");
      setAttachmentUrl(d.attachmentUrl ?? "");
    },
    {
      onReset: () => {
        setTitle("");
        setContentHtml("");
        setAttachmentUrl("");
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    const isEmpty = !title && isRichTextEmpty(contentHtml) && !attachmentUrl;
    if (isEmpty) {
      clear();
      return;
    }
    save({ title, contentHtml, attachmentUrl });
  }, [loaded, title, contentHtml, attachmentUrl, save, clear]);

  // 저장 성공 시 draft 삭제 + 낙관적 업데이트 + 패널 닫기
  useEffect(() => {
    if (
      state.success &&
      state.thread &&
      handledThreadIdRef.current !== state.thread.id
    ) {
      handledThreadIdRef.current = state.thread.id;
      clear({
        reason: "submitted",
        submittedData: submittedDraftRef.current ?? { title, contentHtml, attachmentUrl },
      });
      submittedDraftRef.current = null;
      const { id, title: savedTitle, createdAt } = state.thread;
      const newItem: UnifiedItem = {
        id,
        type: "QNA",
        subType: "OPEN",
        title: savedTitle,
        date: new Date(createdAt),
        metadata: { status: "OPEN" },
      };
      onSuccess(newItem);
      router.push(`/dashboard/qna/${id}?returnTo=${encodeURIComponent(returnTo)}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.thread?.id]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
      onSubmit={(event) => {
        if (isFormBusy) {
          event.preventDefault();
          return;
        }
        submittedDraftRef.current = { title, contentHtml, attachmentUrl };
      }}
    >
      <input type="hidden" name="contentHtml" value={contentHtml} />

      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      {/* 제목 */}
      <div className="space-y-1.5">
        <label htmlFor="qna-slide-title" className="text-sm font-medium">
          질문 제목 <span className="text-destructive">*</span>
        </label>
        <Input
          id="qna-slide-title"
          name="title"
          placeholder="질문 제목을 입력하세요"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          disabled={isPending}
        />
      </div>

      {/* 에디터 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          내용 <span className="text-destructive">*</span>
        </label>
        {loaded && (
          <FullEditor
            initialContent={contentHtml}
            onChange={setContentHtml}
            placeholder="질문 내용을 자세히 작성하세요..."
            disabled={isPending}
            minHeight="300px"
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
        )}
      </div>

      {/* 첨부 파일 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">첨부 파일</label>
        <AttachmentField
          value={attachmentUrl}
          onChange={setAttachmentUrl}
          disabled={isPending}
          onUploadingChange={setIsUploading}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isFormBusy || !title.trim() || isRichTextEmpty(contentHtml)} className="flex-1">
          {isUploading ? "업로드 완료 대기..." : isPending ? "전송 중..." : "질문 등록"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={isFormBusy}>
          취소
        </Button>
      </div>
    </form>
  );
}
