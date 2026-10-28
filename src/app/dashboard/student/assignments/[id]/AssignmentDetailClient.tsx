"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, ExternalLink, Trash2 } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import {
  VideoPlayer,
  type MediaSeekRequest,
  type PlaybackPositionReader,
} from "@/components/player/VideoPlayer";
import { mediaSourceLabel } from "@/components/player/media-source";
import { TimelineFeedback, type FeedbackItem } from "@/components/feedback/TimelineFeedback";
import { AssignmentDeleteAction } from "@/components/student-portal/AssignmentDeleteAction";
import { FreeSubmissionForm } from "@/components/student-portal/FreeSubmissionForm";
import { Button } from "@/components/ui/button";
import { useConfirmAction } from "@/components/ui/confirm-action";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
import { cn } from "@/lib/utils";

interface AssignmentDetailClientProps {
  assignmentId: string;
  actorId: string;
  /** 글만 제출하면 null. 링크가 있을 때만 플레이어를 보인다. */
  mediaUrl: string | null;
  textHtml: string | null;
  /** 관리자가 낸 과제에 대한 제출이면 과제 정보 */
  task: {
    title: string;
    descriptionHtml: string;
    formatLabel: string;
    dueLabel: string | null;
    late: boolean;
  } | null;
  feedbackList: FeedbackItem[];
  isAdmin: boolean;
  /** 피드백 전 본인 제출을 삭제할 수 있을 때 삭제 뒤 돌아갈 경로. */
  deleteReturnTo?: string;
  /** 머리 제목(과제 제목, 자유 제출은 제공처 이름) */
  title: string;
  /** 넓은 화면 제출 시각(연도 포함)과 좁은 화면 제출 시각 */
  submittedLabel: string;
  submittedLabelShort: string;
  /** 넓은 화면 위치 표시의 상위 항목 */
  breadcrumb: { href: string; label: string };
  /** 좁은 화면 위쪽 막대의 뒤로 */
  returnTo: string;
  /** 관리자가 볼 때 학생 스페이스 링크 */
  spaceLink?: { href: string; label: string };
}

const MENU_ITEM_CLASS =
  "flex h-11 w-full cursor-default select-none items-center gap-2.5 rounded-touch px-3 text-md text-foreground outline-none data-[highlighted]:bg-muted";

/** 좁은 화면 위쪽 막대 오른쪽의 더 보기: (링크 제출이면) 원본 열기와 (피드백 전 본인 제출이면) 제출 삭제. */
function AssignmentMoreMenu({
  mediaUrl,
  onRequestDelete,
}: {
  mediaUrl: string | null;
  onRequestDelete?: (trigger: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deleteChosen = useRef(false);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label="더 보기"
          className="flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <Ellipsis className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          // 삭제를 고르면 메뉴의 focus scope가 끝난 뒤 확인을 연다. 확인을 닫으면 이 버튼으로 돌아온다.
          onCloseAutoFocus={(event) => {
            if (!deleteChosen.current) return;
            deleteChosen.current = false;
            event.preventDefault();
            onRequestDelete?.(triggerRef.current);
          }}
          style={{ zIndex: "var(--z-dropdown)" }}
          className="portal-menu w-56 rounded-lg border border-border bg-background p-1 shadow-floating"
        >
          {mediaUrl ? (
            <DropdownMenu.Item asChild className={MENU_ITEM_CLASS}>
              <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
                원본 열기
              </a>
            </DropdownMenu.Item>
          ) : null}
          {onRequestDelete ? (
            <DropdownMenu.Item
              className={cn(MENU_ITEM_CLASS, "text-destructive")}
              onSelect={() => { deleteChosen.current = true; }}
            >
              <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
              제출 삭제
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * 과제 상세(AssignmentDetail·MobileAssignment 보드): 위치·머리·플레이어·타임라인 피드백.
 * 넓은 화면은 위치 → 머리 → [플레이어 | 피드백], 좁은 화면은 화면 폭 플레이어 → 머리 → 피드백 순서로 보인다.
 */
export function AssignmentDetailClient({
  assignmentId,
  actorId,
  mediaUrl,
  textHtml,
  task,
  feedbackList,
  isAdmin,
  deleteReturnTo,
  title,
  submittedLabel,
  submittedLabelShort,
  breadcrumb,
  returnTo,
  spaceLink,
}: AssignmentDetailClientProps) {
  const router = useProgressRouter();
  const [seekRequest, setSeekRequest] = useState<MediaSeekRequest>();
  const positionReaderRef = useRef<PlaybackPositionReader | null>(null);
  const handlePositionReaderChange = useCallback((reader: PlaybackPositionReader | null) => {
    positionReaderRef.current = reader;
  }, []);
  const readPlaybackPosition = useCallback(
    async () => (positionReaderRef.current ? positionReaderRef.current() : null),
    [],
  );
  const deleteConfirm = useConfirmAction();
  const canDelete = Boolean(deleteReturnTo) && feedbackList.length === 0;
  const requestDelete = deleteConfirm.request;
  // 본인 자유 제출(관리자 과제가 아닌 제출)은 피드백 전에 이 화면에서 바로 고친다.
  const canEditFree = canDelete && !task;
  const [editingFree, setEditingFree] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const openFreeEdit = () => {
    setEditingFree(true);
    // 버튼이 폼으로 바뀌므로 첫 칸으로 focus를 옮긴다(초안 확인 전 잠시 비활성이면 다음 frame에 한 번 더).
    requestAnimationFrame(() => {
      if (editInputRef.current && !editInputRef.current.disabled) editInputRef.current.focus();
      else requestAnimationFrame(() => editInputRef.current?.focus());
    });
  };
  const closeFreeEdit = () => {
    setEditingFree(false);
    requestAnimationFrame(() => editTriggerRef.current?.focus());
  };

  const topBarActions = useMemo(
    () => (mediaUrl || canDelete
      ? <AssignmentMoreMenu mediaUrl={mediaUrl} onRequestDelete={canDelete ? requestDelete : undefined} />
      : null),
    [canDelete, mediaUrl, requestDelete],
  );

  const handleSeek = (seconds: number) => {
    setSeekRequest({ seconds });
  };

  // 좁은 화면은 플레이어 → 머리 → 피드백, 넓은 화면은 머리가 두 열 위에 놓인다. 머리는 상태가 없어 폭마다 한 벌만
  // 보이게 두 번 둔다(숨은 벌은 display:none이라 읽기·Tab 순서에 들어가지 않는다).
  const renderHeader = (layout: "narrow" | "wide") => (
    <header className={cn("flex flex-col gap-0.5 px-5 pt-4 md:gap-1 md:px-0 md:pt-0", layout === "narrow" ? "md:hidden" : "max-md:hidden")}>
      <h1 className="text-xl font-semibold tracking-title md:text-display md:tracking-display">{title}</h1>
      <p className="flex flex-wrap items-center gap-x-2 text-ui text-muted-foreground md:gap-x-0">
        {spaceLink ? (
          <>
            <Link href={spaceLink.href} className="font-medium text-foreground underline-offset-4 hover:underline">
              {spaceLink.label}
            </Link>
            <span aria-hidden="true">&nbsp;·&nbsp;</span>
          </>
        ) : null}
        <span>
          <span className="md:hidden">{submittedLabelShort}</span>
          <span className="hidden md:inline">{submittedLabel}</span>
          {task?.late ? " · 늦은 제출" : ""}
          {mediaUrl ? ` · ${mediaSourceLabel(mediaUrl)}` : ""}
        </span>
        {mediaUrl ? (
          <>
            <span aria-hidden="true" className="hidden md:inline">&nbsp;·&nbsp;</span>
            <a
              href={mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1 rounded-sm text-secondary-foreground underline underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-auto"
            >
              원본 열기
              <ExternalLink className="size-3 md:hidden" strokeWidth={1.8} aria-hidden="true" />
            </a>
          </>
        ) : null}
      </p>
    </header>
  );

  // 과제 설명(관리자가 낸 과제)과 학생이 쓴 글. 둘 다 없으면 그리지 않는다.
  const taskBrief = task ? (
    <section aria-label="과제 내용" className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">
        {[`제출 형식: ${task.formatLabel}`, task.dueLabel].filter(Boolean).join(" · ")}
      </p>
      {task.descriptionHtml ? (
        <RichTextContent html={task.descriptionHtml} className="text-body leading-6 text-secondary-foreground" />
      ) : (
        <p className="text-body text-muted-foreground">과제 설명이 없습니다.</p>
      )}
    </section>
  ) : null;
  const submittedText = textHtml ? (
    <section aria-labelledby="assignment-text-heading" className="flex flex-col gap-2">
      <h2 id="assignment-text-heading" className="border-b border-border pb-2 text-ui font-semibold text-secondary-foreground">
        제출한 글
      </h2>
      <RichTextContent html={textHtml} className="text-md leading-7 md:text-body" />
    </section>
  ) : null;
  const editHint = !isAdmin && task && feedbackList.length === 0 ? (
    <p className="text-xs text-muted-foreground">
      피드백이 달리기 전에는{" "}
      <Link href={STUDENT_LEGACY_REDIRECTS.assignments} className="underline underline-offset-[3px] hover:text-foreground">
        과제 화면
      </Link>
      에서 제출을 고칠 수 있습니다.
    </p>
  ) : canEditFree ? (
    editingFree ? (
      <FreeSubmissionForm
        actorId={actorId}
        submission={{ id: assignmentId, mediaUrl, textHtml }}
        idPrefix={`free-submission-${assignmentId}`}
        inputRef={editInputRef}
        className="rounded-lg border border-border p-4"
        onDone={() => {
          closeFreeEdit();
          router.refresh();
        }}
        onCancel={closeFreeEdit}
      />
    ) : (
      <div className="flex flex-col items-start gap-1">
        <p className="text-xs text-muted-foreground">피드백이 달리기 전에는 링크와 글을 고칠 수 있습니다.</p>
        <Button ref={editTriggerRef} type="button" variant="outline" className="max-md:h-11" onClick={openFreeEdit}>
          제출 수정
        </Button>
      </div>
    )
  ) : null;
  return (
    <div className="flex flex-col pb-8 md:gap-7 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar
        title="과제"
        back={{ href: returnTo, label: returnTo === STUDENT_LEGACY_REDIRECTS.assignments ? "과제 목록으로" : "이전 화면으로" }}
        actions={topBarActions}
      />

      <nav aria-label="위치" className="hidden min-w-0 items-center gap-1.5 text-ui md:flex">
        <Link
          href={breadcrumb.href}
          className="shrink-0 rounded-sm text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {breadcrumb.label}
        </Link>
        <span aria-hidden="true" className="text-faint">/</span>
        <span aria-current="page" className="truncate text-foreground">{title}</span>
      </nav>

      {renderHeader("wide")}

      {/* 좁은 화면에서는 이 묶음이 사라져(contents) 플레이어·머리·피드백이 문서 순서대로 놓인다.
          글만 제출했으면 플레이어 없이 과제·글·피드백을 한 열로 놓는다. */}
      <div className={mediaUrl ? "contents md:flex md:flex-wrap md:items-start md:gap-10" : "contents md:flex md:max-w-[720px] md:flex-col md:gap-7"}>
        {mediaUrl ? (
          <div className="flex min-w-0 flex-col gap-3 md:sticky md:top-6 md:flex-[3_1_520px]">
            <VideoPlayer url={mediaUrl} seekRequest={seekRequest} onPositionReaderChange={handlePositionReaderChange} />
          </div>
        ) : null}
        {renderHeader("narrow")}
        <div className={cn("flex min-w-0 flex-col gap-6 px-5 pt-4 md:px-0 md:pt-0", mediaUrl && "md:flex-[2_1_340px]")}>
          {taskBrief}
          {submittedText}
          {editHint}
          <TimelineFeedback
            assignmentId={assignmentId}
            actorId={actorId}
            feedbackList={feedbackList}
            isAdmin={isAdmin}
            onSeek={mediaUrl ? handleSeek : undefined}
            readPlaybackPosition={isAdmin && mediaUrl ? readPlaybackPosition : undefined}
            allowTimeMarker={Boolean(mediaUrl)}
          />
          {canDelete && deleteReturnTo ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">잘못 제출했다면 피드백이 달리기 전에 삭제할 수 있습니다.</p>
              <AssignmentDeleteAction
                assignmentId={assignmentId}
                confirm={deleteConfirm}
                onDeleted={() => {
                  router.replace(deleteReturnTo);
                  router.refresh();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
