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
import { useConfirmAction } from "@/components/ui/confirm-action";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
import { cn } from "@/lib/utils";

interface AssignmentDetailClientProps {
  assignmentId: string;
  actorId: string;
  mediaUrl: string;
  feedbackList: FeedbackItem[];
  isAdmin: boolean;
  /** 피드백 전 본인 제출을 삭제할 수 있을 때 삭제 뒤 돌아갈 경로. */
  deleteReturnTo?: string;
  /** 머리 제목(제출 이름이 없어 제공처 이름) */
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

/** 좁은 화면 위쪽 막대 오른쪽의 더 보기: 원본 열기와 (피드백 전 본인 제출이면) 제출 삭제. */
function AssignmentMoreMenu({
  mediaUrl,
  onRequestDelete,
}: {
  mediaUrl: string;
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
          <DropdownMenu.Item asChild className={MENU_ITEM_CLASS}>
            <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              원본 열기
            </a>
          </DropdownMenu.Item>
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

  const topBarActions = useMemo(
    () => <AssignmentMoreMenu mediaUrl={mediaUrl} onRequestDelete={canDelete ? requestDelete : undefined} />,
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
          {` · ${mediaSourceLabel(mediaUrl)}`}
        </span>
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
      </p>
    </header>
  );
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

      {/* 좁은 화면에서는 이 묶음이 사라져(contents) 플레이어·머리·피드백이 문서 순서대로 놓인다. */}
      <div className="contents md:flex md:flex-wrap md:items-start md:gap-10">
        <div className="flex min-w-0 flex-col gap-3 md:sticky md:top-6 md:flex-[3_1_520px]">
          <VideoPlayer url={mediaUrl} seekRequest={seekRequest} onPositionReaderChange={handlePositionReaderChange} />
        </div>
        {renderHeader("narrow")}
        <div className="flex min-w-0 flex-col gap-6 px-5 pt-4 md:flex-[2_1_340px] md:px-0 md:pt-0">
          <TimelineFeedback
            assignmentId={assignmentId}
            actorId={actorId}
            feedbackList={feedbackList}
            isAdmin={isAdmin}
            onSeek={handleSeek}
            readPlaybackPosition={isAdmin ? readPlaybackPosition : undefined}
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
