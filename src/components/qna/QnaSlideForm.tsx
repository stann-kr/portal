/**
 * @file src/components/qna/QnaSlideForm.tsx
 * @description SlidePanel 내 Q&A 인라인 작성 폼.
 * 저장 성공 시 `onSuccess(newItem)` 콜백으로 낙관적 업데이트 트리거.
 * 첨부 파일 업로드 + 임시저장(draft) 자동 복원 지원.
 */
"use client";

import { useActionState, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { createQnaThreadInline, type CreateThreadInlineState } from "@/lib/actions/qna";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false },
);

const DRAFT_KEY = "draft:qna:thread";

interface QnaDraft {
  title: string;
  contentHtml: string;
  attachmentUrl: string;
}

interface QnaSlideFormProps {
  onSuccess: (item: UnifiedItem) => void;
  onClose: () => void;
}

export function QnaSlideForm({ onSuccess, onClose }: QnaSlideFormProps) {
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [state, formAction, isPending] = useActionState<CreateThreadInlineState, FormData>(
    createQnaThreadInline,
    {},
  );

  // 임시저장 복원/저장
  const { loaded, save, clear } = useFormDraft<QnaDraft>(DRAFT_KEY, (d) => {
    setTitle(d.title ?? "");
    setContentHtml(d.contentHtml ?? "");
    setAttachmentUrl(d.attachmentUrl ?? "");
  });

  useEffect(() => {
    if (!loaded) return;
    const isEmpty = !title && (!contentHtml || contentHtml === "<p></p>") && !attachmentUrl;
    if (isEmpty) {
      clear();
      return;
    }
    save({ title, contentHtml, attachmentUrl });
  }, [loaded, title, contentHtml, attachmentUrl, save, clear]);

  // 저장 성공 시 draft 삭제 + 낙관적 업데이트 + 패널 닫기
  useEffect(() => {
    if (state.success && state.thread) {
      clear();
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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-4">
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
          />
        )}
      </div>

      {/* 첨부 파일 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">첨부 파일</label>
        <AttachmentField value={attachmentUrl} onChange={setAttachmentUrl} disabled={isPending} />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending || !contentHtml} className="flex-1">
          {isPending ? "전송 중..." : "질문 등록"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          취소
        </Button>
      </div>
    </form>
  );
}
