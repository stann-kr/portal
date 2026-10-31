/**
 * @file src/components/qna/QnaSlideForm.tsx
 * @description SlidePanel 내 Q&A 인라인 작성 폼.
 * 저장 성공 시 `onSuccess(newItem)` 콜백으로 낙관적 업데이트 트리거.
 * 첨부 파일 업로드 + 실시간 작성본(여러 기기에서 같은 작성본, 선택창 없음).
 */
"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AttachmentField } from "@/components/qna/AttachmentField";
import { useCollabFormDraft } from "@/lib/collab/client/useCollabFormDraft";
import { useEditorExtensions } from "@/components/editor/useEditorExtensions";
import { createQnaThreadInline, type CreateThreadInlineState } from "@/lib/actions/qna";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { CollabDraftStatus } from "@/components/editor/CollabDraftStatus";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { abandonMediaUpload } from "@/lib/actions/upload";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false },
);

/** 가이드의 특정 구간에 남기는 질문 위치. 있으면 질문과 함께 저장되고 초안도 그 위치별로 따로 둔다. */
export type QnaGuideAnchorInput = {
  pageId: string;
  pageTitle: string;
  blockId: string | null;
  quote: string;
};

interface QnaSlideFormProps {
  actorId: string;
  spaceLabel: string;
  onSuccess: (item: UnifiedItem) => void;
  onClose: () => void;
  returnTo: string;
  onBusyChange?: (isBusy: boolean) => void;
  guideAnchor?: QnaGuideAnchorInput;
  /** false면 등록 뒤 질문 화면으로 옮기지 않고 지금 화면에 남는다(가이드 질문). */
  navigateOnSuccess?: boolean;
}

function draftContextId(anchor: QnaGuideAnchorInput | undefined): string {
  if (!anchor) return "new";
  // room key 한 칸은 영문·숫자·_- 100자까지다. 가이드 위치마다 다른 작성본을 쓴다.
  return `guide-${anchor.pageId}-${anchor.blockId ?? "page"}`.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 100);
}

const QNA_FIELDS = { title: "", attachmentUrl: "", attachmentObjectId: "" };

export function QnaSlideForm(props: QnaSlideFormProps) {
  return <QnaSlideFormContent key={`${props.actorId}:${draftContextId(props.guideAnchor)}`} {...props} />;
}

function QnaSlideFormContent({
  actorId,
  spaceLabel,
  onSuccess,
  onClose,
  returnTo,
  onBusyChange,
  guideAnchor,
  navigateOnSuccess = true,
}: QnaSlideFormProps) {
  // 같은 사람의 같은 위치(새 질문·가이드 문단) 작성본은 기기와 관계없이 하나다.
  const getExtensions = useEditorExtensions();
  const draft = useCollabFormDraft({
    room: { draftKind: "qna-thread", ownerId: actorId, scope: draftContextId(guideAnchor) },
    fields: QNA_FIELDS,
    extensions: getExtensions,
  });
  const { title, attachmentUrl, attachmentObjectId } = draft.fields;
  const { contentHtml, operationId } = draft;
  const loaded = draft.ready && draft.collab.mode === "write";
  const [isUploading, setIsUploading] = useState(false);
  // 본문 이미지가 올라가는 동안에는 제출하지 않는다. 편집기는 계속 쓸 수 있다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [state, formAction, isPending] = useActionState<CreateThreadInlineState, FormData>(
    async (previous, data) => {
      try {
        return await createQnaThreadInline(previous, data);
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
      }
    },
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const handledThreadIdRef = useRef<string | null>(null);
  const router = useProgressRouter();
  const isFormBusy = isPending || isUploading;
  useBusyNavigationGuard(isFormBusy);

  useEffect(() => {
    onBusyChange?.(isFormBusy || isEditorUploading);
  }, [isEditorUploading, isFormBusy, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 작성본은 입력하는 대로 실시간 보관되므로 Cmd/Ctrl+S는 따로 할 일이 없다(브라우저 저장 창만 막는다).
  const handleSaveShortcut = useDocumentSaveShortcut({ disabled: !loaded, onSave: () => undefined });

  // 저장 성공 시 draft 삭제 + 낙관적 업데이트 + 패널 닫기
  useEffect(() => {
    if (
      state.success &&
      state.thread &&
      handledThreadIdRef.current !== state.thread.id
    ) {
      handledThreadIdRef.current = state.thread.id;
      // 등록한 작성본은 모든 기기에서 비운다(제출 뒤 바뀐 입력이 있으면 남긴다).
      draft.clearSubmitted();
      const { id, title: savedTitle, createdAt } = state.thread;
      const newItem: UnifiedItem = {
        id,
        type: "QNA",
        subType: "OPEN",
        title: savedTitle,
        date: new Date(createdAt),
        metadata: { status: "OPEN" },
        space: { studentId: actorId, label: spaceLabel },
        source: { kind: "PORTAL", entity: "QNA_THREAD", label: "포탈" },
      };
      onSuccess(newItem);
      if (navigateOnSuccess) {
        router.push(`/dashboard/qna/${id}?returnTo=${encodeURIComponent(returnTo)}`);
      } else {
        router.refresh();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.thread?.id]);

  const hasOperationConflict = Boolean(
    state.operationConflict &&
    state.conflictedOperationId === operationId &&
    state.existingId,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={!loaded || isFormBusy}
      className="flex flex-col gap-5"
      onKeyDownCapture={handleSaveShortcut}
      onSubmit={(event) => {
        if (!loaded || isFormBusy || isEditorUploading || !operationId) {
          event.preventDefault();
          return;
        }
        const latestContentHtml = draft.readHtml();
        if (!title.trim() || isRichTextEmpty(latestContentHtml)) {
          event.preventDefault();
          return;
        }
        if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
            draft.markSubmitted();
      }}
    >
      <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
      <input ref={contentInputRef} type="hidden" name="contentHtml" value={contentHtml} />
      {guideAnchor ? (
        <>
          <input type="hidden" name="guidePageId" value={guideAnchor.pageId} />
          <input type="hidden" name="guideBlockId" value={guideAnchor.blockId ?? ""} />
          <input type="hidden" name="guideQuote" value={guideAnchor.quote} />
          <figure className="flex flex-col gap-1 border-l-2 border-highlight pl-3">
            <figcaption className="text-xs text-muted-foreground">가이드: {guideAnchor.pageTitle}</figcaption>
            <blockquote className="line-clamp-4 text-body text-secondary-foreground">“{guideAnchor.quote}”</blockquote>
          </figure>
        </>
      ) : null}

      {state.error && (!state.operationConflict || hasOperationConflict) && (
        <p role="alert" className="rounded-lg border border-destructive-border bg-destructive-muted p-3 text-ui text-destructive">{state.error}</p>
      )}

      {hasOperationConflict && state.existingId ? (
        <CreationConflictActions
          existingHref={`/dashboard/qna/${state.existingId}?returnTo=${encodeURIComponent(returnTo)}`}
          existingLabel="기존 질문 열기"
          separateLabel="별도 질문으로 저장"
          onSeparate={() => {
            if (attachmentObjectId) {
              void abandonMediaUpload(attachmentObjectId).catch(() => undefined);
            }
            draft.setField("attachmentUrl", "");
            draft.setField("attachmentObjectId", "");
            draft.rotateOperation();
          }}
          disabled={isFormBusy}
        />
      ) : null}

      {/* 제목 */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="qna-slide-title" className="text-body font-medium text-secondary-foreground md:text-ui">
          제목 <span className="sr-only">필수</span>
        </label>
        <Input
          id="qna-slide-title"
          name="title"
          placeholder="질문 제목을 입력하세요"
          value={title}
          onChange={(e) => draft.setField("title", e.target.value)}
          required
          disabled={!loaded || isFormBusy}
          className="h-12 px-3.5 md:h-10 md:px-3 md:text-md"
        />
      </div>

      {/* 에디터 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-body font-medium text-secondary-foreground md:text-ui">
          내용 <span className="sr-only">필수</span>
        </span>
        {loaded && draft.collaboration ? (
          <FullEditor
            key={draft.collab.generation}
            collaboration={draft.collaboration}
            onUploadingChange={setIsEditorUploading}
            placeholder="질문 내용을 자세히 작성하세요..."
            disabled={isFormBusy}
            minHeight="12.5rem"
            ariaLabel="Q&A 질문 내용"
            toolbar="compact"
            footer={<CollabDraftStatus draft={draft} />}
          />
        ) : null}
      </div>

      {/* 첨부 파일 */}
      <div className="flex flex-col gap-2">
        <span className="text-body font-medium text-secondary-foreground md:text-ui">첨부 파일</span>
        <AttachmentField
          value={attachmentUrl}
          mediaObjectId={attachmentObjectId}
          draftOperationId={operationId}
          onChange={(upload) => {
            draft.setField("attachmentUrl", upload?.deliveryUrl ?? "");
            draft.setField("attachmentObjectId", upload?.mediaObjectId ?? "");
          }}
          disabled={!loaded || isFormBusy}
          onUploadingChange={setIsUploading}
          trigger="inline"
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-muted pt-3">
        <Button type="button" variant="outline" size="touch" onClick={onClose} disabled={isFormBusy || isEditorUploading} className="md:h-9 md:rounded-md md:px-3.5 md:text-ui">
          취소
        </Button>
        <Button type="submit" size="touch" disabled={!loaded || isFormBusy || isEditorUploading || !operationId || !title.trim() || isRichTextEmpty(contentHtml)} className="flex-1 md:h-9 md:flex-none md:rounded-md md:px-4 md:text-ui">
          {isUploading || isEditorUploading ? "업로드 완료 대기..." : isPending ? "전송 중..." : "질문 등록"}
        </Button>
      </div>
    </form>
  );
}
