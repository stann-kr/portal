/**
 * @file src/components/qna/ThreadDetailClient.tsx
 * @description Q&A 스레드 상세 클라이언트 컴포넌트(캔버스 QnaThread·MobileQnaThread 보드).
 * 위치·제목·상태 머리, 대화 목록, 추가 질문(관리자는 답변) 작성 폼과 관리자 상태 변경.
 * 좁은 화면에서는 이력·휴지통을 위쪽 막대의 더 보기 메뉴로 옮긴다.
 */
"use client";

import { useActionState, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, History, RotateCcw, Trash2 } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import dynamic from "next/dynamic";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);
import { ReplyCard } from "./ReplyCard";
import { AttachmentField } from "./AttachmentField";
import { MobileMoreMenu, type MobileMoreMenuItem } from "./MobileMoreMenu";
import { QnaStatusLabel } from "./qna-display";
import { useSyncedFormDraft } from "@/lib/hooks/useSyncedFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { createQnaReply, updateThreadStatus, type CreateReplyState } from "@/lib/actions/qna";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";
import type { QnaStatus } from "@/db/schema";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey, type FormDraftStatus } from "@/lib/form-draft";
import type { DocumentServerDraftSyncResult } from "@/lib/hooks/useDocumentServerDraftSync";
import { isRichTextEmpty } from "@/lib/rich-text";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useDocumentSaveShortcut } from "@/lib/hooks/useDocumentSaveShortcut";
import { persistLocalDraftOnShortcut } from "@/lib/local-draft-shortcut";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  parseCreationOperationId,
} from "@/lib/creation-operation";
import { CreationConflictActions } from "@/components/editor/CreationConflictActions";
import { QNA_LIFECYCLE_LABELS, useQnaThreadLifecycle, type QnaLifecycleKind } from "@/components/qna/QnaThreadLifecycleActions";
import { abandonMediaUpload } from "@/lib/actions/upload";
import { formatKst, formatKstShortDate } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

/** 넓은 화면 머리와 좁은 화면 메뉴가 같은 이름을 쓴다. 휴지통 이동은 캔버스대로 아이콘 버튼의 이름이다. */
const LIFECYCLE_TRIGGER_LABELS: Record<QnaLifecycleKind, string> = {
  trash: "휴지통으로 이동",
  restore: QNA_LIFECYCLE_LABELS.restore,
  purge: QNA_LIFECYCLE_LABELS.purge,
};

const STATUS_OPTIONS: readonly QnaStatus[] = ["OPEN", "ANSWERED", "CLOSED"];

/**
 * 답글 상자 바닥 줄의 짧은 초안 상태(QnaThread "초안 저장됨"). 이 기기 초안과 계정 동기화를 함께 본다.
 * 자세한 줄·복구본·계정 초안 관리는 이 문구를 눌러 펼치고, 판단할 일이 생기면 저절로 펼쳐 보인다.
 */
function replyDraftSummary(
  status: FormDraftStatus,
  restored: boolean,
  sync: DocumentServerDraftSyncResult | undefined,
): string {
  if (status === "error" || status === "incompatible" || status === "conflict") return "초안 확인 필요";
  if (status === "saving" || sync?.status === "queued" || sync?.status === "syncing") return "저장 중…";
  if (status === "saved") return restored ? "초안 복원됨" : "초안 저장됨";
  return "초안 자동 저장";
}

function readSaveShortcutKey(): string {
  if (typeof navigator === "undefined") return "Ctrl+S";
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform || navigator.userAgent) ? "⌘S" : "Ctrl+S";
}

type Reply = {
  id: string;
  contentHtml: string;
  attachmentUrl: string | null | undefined;
  createdAt: Date | null | undefined;
  authorName: string | null | undefined;
  authorEmail: string | null | undefined;
  authorRole: string | null | undefined;
};

type QnaReplyDraft = {
  operationId?: string;
  contentHtml: string;
  attachmentUrl: string;
  attachmentObjectId?: string;
};

interface ThreadDetailClientProps {
  threadId: string;
  status: QnaStatus;
  version: number;
  deletedAt: string | null;
  replies: Reply[];
  isAdmin: boolean;
  actorId: string;
  title: string;
  studentName: string;
  createdAt: string | null;
  returnTo: string;
}

export function ThreadDetailClient(props: ThreadDetailClientProps) {
  return <ThreadDetailContent key={JSON.stringify([props.actorId, props.threadId])} {...props} />;
}

function ThreadDetailContent({
  threadId,
  status,
  version,
  deletedAt,
  replies: initialReplies,
  isAdmin,
  actorId,
  title,
  studentName,
  createdAt,
  returnTo,
}: ThreadDetailClientProps) {
  const {
    contentHtml,
    contentVersion,
    setContentHtml,
    handleEditorChange,
    handleEditorDirty,
    readLatestContentHtml,
    commitLatestContentHtml,
  } = useDeferredEditorContent("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentObjectId, setAttachmentObjectId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  // 본문 이미지가 올라가는 동안에는 제출하지 않는다. 편집기는 계속 쓸 수 있다.
  const [isEditorUploading, setIsEditorUploading] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // 바닥 줄에 둘 자리가 없는 첨부 업로드 실패 안내는 입력란 위 안내 자리에 그린다.
  const [attachmentError, setAttachmentError] = useState("");
  const [draftDetailsOpen, setDraftDetailsOpen] = useState(false);
  const draftDetailsId = useId();
  // 편집기의 이미지 업로드 상태·마크다운 전환을 바닥 줄(좁은 화면은 초안 상태 줄)에 넣는 자리.
  const [editorToolsElement, setEditorToolsElement] = useState<HTMLSpanElement | null>(null);
  const [isPending, startTransition] = useTransition();
  // 상태와 CAS 기준은 같은 서버 snapshot에서 가져온다.
  const currentStatus = status;
  const currentVersion = version;
  const [statusError, setStatusError] = useState<string | null>(null);
  const statusOperationIdsRef = useRef(new Map<string, string>());
  const formRef = useRef<HTMLFormElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const submittedReplyRef = useRef<QnaReplyDraft | null>(null);
  const handledReplyIdRef = useRef<string | null>(null);
  const router = useRouter();

  const [replyState, replyAction, isReplying] = useActionState<
    CreateReplyState,
    FormData
  >(async (previous, data) => {
    try {
      return await createQnaReply(threadId, previous, data);
    } catch {
      return { error: "저장 결과를 확인하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요." };
    }
  }, {});
  const isReplyFormBusy = isReplying || isUploading || isPending;
  useBusyNavigationGuard(isReplyFormBusy);

  // 스레드별 임시저장 복원/저장
  const {
    loaded,
    canSubmit,
    save,
    clear,
    flush,
    status: draftStatus,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
    serverSync,
  } = useSyncedFormDraft<QnaReplyDraft>(
    createDocumentDraftKey("qna-reply", actorId, threadId),
    (d) => {
      setOperationId(
        parseCreationOperationId(d.operationId) ?? createCreationOperationId(),
      );
      setContentHtml(d.contentHtml ?? "");
      setAttachmentUrl(d.attachmentUrl ?? "");
      setAttachmentObjectId(d.attachmentObjectId ?? "");
    },
    {
      onReset: () => {
        setOperationId(createCreationOperationId());
        setContentHtml("");
        setAttachmentUrl("");
        setAttachmentObjectId("");
        setAttachmentError("");
        setEditorKey((key) => key + 1);
      },
    },
  );
  const handleReplySaveShortcut = useDocumentSaveShortcut({
    disabled:
      !loaded ||
      !canSubmit ||
      currentStatus === "CLOSED" ||
      isReplyFormBusy ||
      !operationId,
    onSave: () => persistLocalDraftOnShortcut({
      createSnapshot: () => ({
        operationId,
        contentHtml: readLatestContentHtml(),
        attachmentUrl,
        attachmentObjectId,
      }),
      isEmpty: (draft) =>
        isRichTextEmpty(draft.contentHtml) &&
        !draft.attachmentUrl &&
        !draft.attachmentObjectId,
      clear,
      save,
      flush,
    }),
  });

  useEffect(() => {
    if (!loaded) return;
    const latestContentHtml = readLatestContentHtml();
    const isEmpty =
      isRichTextEmpty(latestContentHtml) &&
      !attachmentUrl &&
      !attachmentObjectId;
    if (isEmpty) {
      clear();
      return;
    }
    if (!operationId) return;
    save({
      operationId,
      attachmentUrl,
      attachmentObjectId,
      get contentHtml() {
        return readLatestContentHtml();
      },
    });
  }, [loaded, contentHtml, attachmentUrl, attachmentObjectId, operationId, readLatestContentHtml, save, clear]);

  // 답변 등록 성공 시 draft 삭제 + 폼 초기화 (에디터 remount)
  useEffect(() => {
    if (replyState.replyId && handledReplyIdRef.current !== replyState.replyId) {
      handledReplyIdRef.current = replyState.replyId;
      clear({
        reason: "submitted",
        submittedData: submittedReplyRef.current ?? {
          operationId,
          contentHtml,
          attachmentUrl,
          attachmentObjectId,
        },
      });
      submittedReplyRef.current = null;
      setOperationId(createCreationOperationId());
      setContentHtml("");
      setAttachmentUrl("");
      setAttachmentObjectId("");
      setAttachmentError("");
      setEditorKey((k) => k + 1);
      router.refresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyState.replyId]);

  const hasOperationConflict = Boolean(
    replyState.operationConflict &&
    replyState.conflictedOperationId === operationId &&
    replyState.existingId,
  );
  const hasReplyDraft =
    !isRichTextEmpty(contentHtml) ||
    Boolean(attachmentUrl) ||
    Boolean(attachmentObjectId) ||
    recoveries.length > 0 ||
    draftStatus !== "idle";
  const showReplyComposer = currentStatus !== "CLOSED" || hasReplyDraft;
  const isTrashed = Boolean(deletedAt);

  const handleStatusChange = (newStatus: QnaStatus) => {
    setStatusError(null);
    startTransition(async () => {
      const operationKey = `${newStatus}:${currentVersion}`;
      const statusOperationId =
        statusOperationIdsRef.current.get(operationKey) ??
        createCreationOperationId();
      statusOperationIdsRef.current.set(operationKey, statusOperationId);
      try {
        const result = await updateThreadStatus(
          threadId,
          newStatus,
          statusOperationId,
          currentVersion,
        );
        if (!result.success) {
          setStatusError(result.error ?? "상태를 변경하지 못했습니다.");
          if (result.currentRevision) router.refresh();
          return;
        }
        statusOperationIdsRef.current.delete(operationKey);
        router.refresh();
      } catch {
        setStatusError("상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const lifecycleButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lifecycle = useQnaThreadLifecycle({
    actionButtonRef: lifecycleButtonRef,
    fallbackFocusRef: titleRef,
    disabled: isReplyFormBusy,
    transition: { isPending, start: startTransition },
    threadId,
    version: currentVersion,
    deletedAt,
    canRestore: true,
    canPurge: isAdmin,
    returnTo,
  });
  // 위쪽 막대 메뉴는 셸이 그리므로 최신 요청 함수를 ref로 넘겨 메뉴 요소를 매 입력마다 새로 만들지 않는다.
  const lifecycleRequestRef = useRef(lifecycle.request);
  useLayoutEffect(() => {
    lifecycleRequestRef.current = lifecycle.request;
  });
  const requestLifecycle = useCallback((trigger: HTMLElement | null) => lifecycleRequestRef.current(trigger), []);

  const historyHref = `/dashboard/qna/${threadId}/history?returnTo=${encodeURIComponent(returnTo)}`;
  const lifecycleKind = lifecycle.actionKind;
  const lifecycleDisabled = lifecycle.triggerDisabled;
  const mobileActions = useMemo(() => {
    const historyItem: MobileMoreMenuItem = { key: "history", label: "변경 이력", Icon: History, href: historyHref };
    const items: MobileMoreMenuItem[] = lifecycleKind
      ? [historyItem, {
        key: lifecycleKind,
        label: LIFECYCLE_TRIGGER_LABELS[lifecycleKind],
        Icon: lifecycleKind === "restore" ? RotateCcw : Trash2,
        destructive: lifecycleKind !== "restore",
        disabled: lifecycleDisabled,
        onSelect: requestLifecycle,
      }]
      : [historyItem];
    return <MobileMoreMenu label="더 보기" items={items} disabled={isReplyFormBusy} />;
  }, [historyHref, isReplyFormBusy, lifecycleDisabled, lifecycleKind, requestLifecycle]);

  const longDate = formatKst(createdAt, { year: "numeric", month: "long", day: "numeric" }, "");
  const shortDate = formatKstShortDate(createdAt, "");
  const submitLabel = isUploading || isEditorUploading
    ? "업로드 완료 대기..."
    : isReplying
      ? "등록 중..."
      : isAdmin
        ? "답변 등록"
        : "질문 추가";
  const backLabel = returnTo.startsWith("/dashboard/qna") ? "Q&A 목록으로" : "이전 화면으로";
  const isClosed = currentStatus === "CLOSED";
  const draftSummary = replyDraftSummary(draftStatus, restored, serverSync);
  // 좁은 화면 입력 막대 grid 자리(MobileQnaThread). 넓은 화면 상자는 flex라 이 자리 class가 쓰이지 않는다.
  // 고른 첨부 칩은 클립 버튼 자리 대신 초안 상태 아래 한 줄을 쓰고, 입력란이 그 칸까지 넓어진다.
  const hasAttachment = Boolean(attachmentUrl);
  const composerCells = {
    attachment: hasAttachment ? "col-span-3 row-start-2 min-w-0" : "col-start-1 row-start-2",
    editor: cn(
      hasAttachment ? "row-start-3" : "row-start-2",
      hasAttachment
        ? (isClosed ? "col-span-3 col-start-1" : "col-span-2 col-start-1")
        : (isClosed ? "col-span-2 col-start-2" : "col-start-2"),
    ),
    submit: cn("col-start-3", hasAttachment ? "row-start-3" : "row-start-2"),
  };

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-7">
      <MobileTopBar title="Q&A" back={{ href: returnTo, label: backLabel }} actions={mobileActions} />

      <nav aria-label="위치" className="hidden min-w-0 items-center gap-1.5 text-ui md:flex">
        <Link
          href={returnTo}
          aria-disabled={isReplyFormBusy}
          tabIndex={isReplyFormBusy ? -1 : undefined}
          className={cn(
            "shrink-0 text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isReplyFormBusy && "pointer-events-none opacity-50",
          )}
          onClick={(event) => {
            if (isReplyFormBusy) event.preventDefault();
          }}
        >
          Q&amp;A
        </Link>
        <span aria-hidden="true" className="text-faint">/</span>
        <span aria-current="page" className="min-w-0 truncate text-foreground">{title}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 ref={titleRef} tabIndex={-1} className="break-words text-xl font-semibold tracking-title focus:outline-none md:text-2xl md:tracking-display">{title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-ui text-muted-foreground">
            <QnaStatusLabel status={currentStatus} />
            <span>
              {"· "}
              {isAdmin ? `${studentName} · ` : null}
              {longDate ? (
                <>
                  <span className="md:hidden">{shortDate} 질문</span>
                  <span className="hidden md:inline">{longDate} 질문</span>
                </>
              ) : "작성일 미정"}
            </span>
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <Link href={historyHref} className={buttonClassName({ variant: "ghost" })}>
            변경 이력
          </Link>
          {lifecycleKind === "trash" ? (
            <Button
              ref={lifecycleButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={LIFECYCLE_TRIGGER_LABELS.trash}
              aria-expanded={lifecycle.confirmOpen}
              disabled={lifecycleDisabled}
              onClick={(event) => lifecycle.request(event.currentTarget)}
            >
              <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </Button>
          ) : lifecycleKind ? (
            <Button
              ref={lifecycleButtonRef}
              type="button"
              variant={lifecycleKind === "purge" ? "destructive" : "outline"}
              aria-expanded={lifecycleKind === "purge" ? lifecycle.confirmOpen : undefined}
              disabled={lifecycleDisabled}
              onClick={(event) => lifecycle.request(event.currentTarget)}
            >
              {lifecycleKind === "restore"
                ? <RotateCcw className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                : <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
              {LIFECYCLE_TRIGGER_LABELS[lifecycleKind]}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col items-start gap-1 empty:hidden">{lifecycle.feedback}</div>

      {isTrashed ? (
        <p role="status" className="rounded-lg border border-warning-border bg-warning-muted p-4 text-body text-foreground">
          휴지통에 있는 Q&amp;A입니다. 답변과 상태 변경 이력은 함께 보존되며 복원 전에는 새 답변을 등록할 수 없습니다.
        </p>
      ) : null}

      {/* 관리자 상태 변경 */}
      {isAdmin && !isTrashed ? (
        <div role="group" aria-label="스레드 상태 변경" className="flex flex-wrap items-center gap-3">
          <span aria-hidden="true" className="text-ui text-secondary-foreground">상태 변경</span>
          <div className="inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5">
            {STATUS_OPTIONS.map((option) => {
              const isCurrent = currentStatus === option;
              return (
                <button
                  key={option}
                  onClick={() => handleStatusChange(option)}
                  type="button"
                  disabled={!loaded || isCurrent || isPending || isReplyFormBusy}
                  aria-pressed={isCurrent}
                  className={cn(
                    "h-7 rounded-sm px-3 text-ui transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:cursor-default",
                    isCurrent
                      ? "bg-background font-medium text-foreground shadow-segment"
                      : "text-secondary-foreground hover:text-foreground disabled:opacity-50",
                  )}
                >
                  {QNA_STATUS_LABELS[option]}
                </button>
              );
            })}
          </div>
          {isPending ? <span role="status" className="text-xs text-muted-foreground">변경 중...</span> : null}
        </div>
      ) : null}
      {statusError ? <p role="alert" className="text-ui text-destructive">{statusError}</p> : null}

      {/* 대화 */}
      <ol className="flex flex-col border-t border-border">
        {initialReplies.map((reply) => (
          <ReplyCard key={reply.id} reply={reply} />
        ))}
      </ol>

      {/* 답변 작성 폼: 넓은 화면은 r10 상자 하나(QnaThread), 좁은 화면은 화면 아래 입력 막대(MobileQnaThread) */}
      {showReplyComposer && !isTrashed && (
        <form
          ref={formRef}
          action={replyAction}
          aria-busy={!loaded || isReplyFormBusy}
          className={cn(
            "sticky bottom-0 z-10 -mx-5 -mb-8 mt-auto flex flex-col gap-2 border-t border-border bg-background px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2",
            "md:static md:z-auto md:mx-0 md:mb-0 md:border-0 md:bg-transparent md:p-0",
          )}
          onKeyDownCapture={handleReplySaveShortcut}
          onSubmit={(event) => {
            if (!loaded || !canSubmit || currentStatus === "CLOSED" || isReplyFormBusy || isEditorUploading || !operationId) {
              event.preventDefault();
              return;
            }
            const latestContentHtml = commitLatestContentHtml();
            if (isRichTextEmpty(latestContentHtml)) {
              event.preventDefault();
              return;
            }
            if (contentInputRef.current) contentInputRef.current.value = latestContentHtml;
            const submittedReply = {
              operationId,
              contentHtml: latestContentHtml,
              attachmentUrl,
              attachmentObjectId,
            };
            save(submittedReply);
            flush();
            submittedReplyRef.current = submittedReply;
          }}
        >
          <input type="hidden" name={CREATION_OPERATION_FIELD} value={operationId} />
          <input ref={contentInputRef} type="hidden" name="contentHtml" value={contentHtml} />
          <p className={cn("text-ui font-semibold text-secondary-foreground", !isClosed && "sr-only")}>
            {isClosed
              ? "미전송 초안"
              : isAdmin
                ? "답변 작성"
                : "추가 질문"}
          </p>
          {/* 안내·오류·충돌 선택은 입력란 위에 둔다(좁은 화면에서는 입력 막대 안에서 길어지면 스크롤). */}
          <div className="flex max-h-[40dvh] flex-col gap-2 overflow-y-auto empty:hidden md:max-h-none md:overflow-visible">
            {isClosed ? (
              <p role="status" className="rounded-lg border border-warning-border bg-warning-muted px-3 py-2 text-ui text-foreground">
                스레드가 종료되어 등록할 수 없지만, 작성 중이던 내용은 이 기기에 보존되어 있습니다. 내용을 복사하거나 관리자가 다시 열 때 이어서 등록할 수 있습니다.
              </p>
            ) : null}
            {replyState.error && (!replyState.operationConflict || hasOperationConflict) && (
              <p role="alert" className="text-ui text-destructive">{replyState.error}</p>
            )}
            {attachmentError ? (
              <p role="alert" className="text-ui text-destructive">파일을 업로드하지 못했습니다. {attachmentError}</p>
            ) : null}
            {hasOperationConflict ? (
              <CreationConflictActions
                existingLabel="현재 답변 새로고침"
                separateLabel="별도 답변으로 등록"
                onOpenExisting={() => router.refresh()}
                onSeparate={() => {
                  if (attachmentObjectId) {
                    void abandonMediaUpload(attachmentObjectId).catch(() => undefined);
                  }
                  setAttachmentUrl("");
                  setAttachmentObjectId("");
                  setOperationId(createCreationOperationId());
                }}
                disabled={isReplyFormBusy}
              />
            ) : null}
            {replyState.success && !hasReplyDraft ? (
              <p role="status" className="text-ui text-success">등록했습니다.</p>
            ) : null}
          </div>

          {/*
            넓은 화면: [본문][바닥 줄: 파일 첨부 · (도구·초안 상태·등록)] 세로 상자.
            좁은 화면: 바닥 줄을 풀어(contents) 한 grid에 놓는다. 1행 초안 상태, (첨부 칩), 마지막 행 클립·입력란·등록.
          */}
          <div
            className={cn(
              "grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-2 gap-y-1",
              "md:flex md:flex-col md:items-stretch md:gap-0 md:rounded-lg md:border md:border-border md:bg-background md:transition-[border-color,box-shadow] md:duration-[var(--duration-fast)] md:focus-within:border-ring md:focus-within:ring-1 md:focus-within:ring-ring md:motion-reduce:transition-none",
            )}
          >
            <div
              className={cn(
                composerCells.editor,
                // MobileQnaThread 입력란: 44px부터 자라는 선 있는 r8 칸. QnaThread는 상자 안의 선 없는 글 칸(최소 96 + 위아래 14).
                "flex max-h-[40dvh] min-h-11 flex-col rounded-touch border border-border bg-background transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring motion-reduce:transition-none",
                "md:max-h-none md:min-h-[124px] md:rounded-none md:border-0 md:bg-transparent md:focus-within:ring-0",
              )}
            >
              {loaded && (
                <FullEditor
                  onUploadingChange={setIsEditorUploading}
                  key={editorKey}
                  variant="bare"
                  toolbar="none"
                  toolsContainer={editorToolsElement}
                  contentClassName="px-3 py-2.5 text-base leading-[22px] md:px-4 md:py-3.5 md:text-md md:leading-6"
                  initialContent={contentHtml}
                  contentVersion={contentVersion}
                  onChange={handleEditorChange}
                  onDirty={(reader) => {
                    handleEditorDirty(reader);
                    if (!operationId) return;
                    save({
                      operationId,
                      attachmentUrl,
                      attachmentObjectId,
                      get contentHtml() {
                        return reader();
                      },
                    });
                  }}
                  placeholder={isAdmin ? "답변을 입력하세요" : "추가 질문을 입력하세요"}
                  disabled={isClosed || isReplyFormBusy}
                  ariaLabel={isAdmin ? "Q&A 답변 내용" : "Q&A 추가 질문 내용"}
                />
              )}
            </div>

            <div className="contents md:flex md:min-h-12 md:items-center md:justify-between md:gap-3 md:border-t md:border-muted md:py-2 md:pl-3 md:pr-2">
              <div className={composerCells.attachment}>
                <AttachmentField
                  value={attachmentUrl}
                  mediaObjectId={attachmentObjectId}
                  draftOperationId={operationId}
                  onChange={(upload) => {
                    setAttachmentUrl(upload?.deliveryUrl ?? "");
                    setAttachmentObjectId(upload?.mediaObjectId ?? "");
                  }}
                  disabled={!loaded || isClosed || isReplyFormBusy}
                  onUploadingChange={setIsUploading}
                  onErrorChange={setAttachmentError}
                  trigger="composer"
                />
              </div>
              <div className="contents md:flex md:shrink-0 md:items-center md:gap-3">
                <div className="col-span-3 row-start-1 flex min-w-0 items-center justify-between gap-3 px-1 md:px-0">
                  {/* 편집기의 이미지 업로드 상태·마크다운 전환이 들어오는 자리 */}
                  <span
                    ref={setEditorToolsElement}
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground empty:hidden"
                  />
                  {loaded ? (
                    <span role="status" aria-live="polite" className="ml-auto shrink-0">
                      <button
                        type="button"
                        aria-expanded={draftDetailsOpen}
                        aria-controls={draftDetailsId}
                        title="임시 저장 상태 자세히 보기"
                        onClick={() => setDraftDetailsOpen((open) => !open)}
                        // 좁은 화면 입력 막대에서도 누르는 곳은 44px(줄 높이는 바꾸지 않는다).
                        className="-my-3 inline-flex h-11 items-center rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:my-0 md:h-auto"
                      >
                        {draftSummary}
                      </button>
                    </span>
                  ) : null}
                </div>
                {!isClosed ? (
                  <Button
                    type="submit"
                    aria-label={submitLabel}
                    disabled={!loaded || !canSubmit || isReplyFormBusy || isEditorUploading || !operationId || isRichTextEmpty(contentHtml)}
                    className={cn(composerCells.submit, "size-11 shrink-0 rounded-touch p-0 md:h-8 md:w-auto md:rounded-md md:px-3.5")}
                  >
                    <ArrowUp className="size-[18px] md:hidden" strokeWidth={1.8} aria-hidden="true" />
                    <span className="hidden md:inline">{submitLabel}</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {/*
            초안 상태 자세히: 평소에는 접혀 있고(비어 있는 묶음은 자리를 차지하지 않는다), 복원·충돌·오류·다른 기기 작성본은 바로 보인다.
            펼치면 묶음이 비지 않으므로 단축키 줄만 따로 남는 일은 없다. 좁은 화면 입력 막대 안에서는 길어지면 스크롤한다.
          */}
          <div
            id={draftDetailsId}
            className="flex flex-col gap-2 empty:hidden has-[>[role=group]:empty]:hidden max-md:max-h-[40dvh] max-md:overflow-y-auto"
          >
            {loaded ? (
              <DraftStatus
                quiet={!draftDetailsOpen}
                status={draftStatus}
                canSubmit={canSubmit}
                savedAt={savedAt}
                restored={restored}
                recoveries={recoveries}
                onRestoreRecovery={restoreRecovery}
                onDiscardRecovery={discardRecovery}
                serverSync={serverSync}
                disabled={isReplyFormBusy}
              />
            ) : null}
            {draftDetailsOpen && canSubmit && !isClosed ? (
              <p className="text-xs text-muted-foreground">
                초안 저장 <kbd className="font-mono">{readSaveShortcutKey()}</kbd>
              </p>
            ) : null}
          </div>
        </form>
      )}

      {currentStatus === "CLOSED" && !hasReplyDraft && !isTrashed && (
        <p className="py-4 text-center text-body text-muted-foreground">
          종료된 스레드입니다.
        </p>
      )}
    </div>
  );
}
