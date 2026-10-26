/**
 * @file src/components/student-portal/AssignmentView.tsx
 * @description 과제 뷰(Assignments·MobileAssignments 보드) — 믹스셋 제출 폼과 제출 목록.
 * 목록 행은 과제 상세(타임라인 피드백) 화면으로 이동한다. RSC에서 받은 initialAssignments를 클라이언트 상태로 관리한다.
 */
"use client";

import { useState, useActionState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlay, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InferSelectModel } from "drizzle-orm";
import { assignments } from "@/db/schema";
import {
  submitAssignment,
  getMyAssignments,
  type SubmitAssignmentState,
} from "@/lib/actions/assignments";
import { getMyFeedbacksMap } from "@/lib/actions/feedbacks";
import { EmptyState } from "@/components/ui/empty-state";
import { describeAssignmentMedia } from "@/lib/unified-item-normalization";
import { formatKst } from "@/lib/kst-format";
import { getPortalStatus } from "@/lib/portal-status";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
import { mediaSourceLabel } from "@/components/player/media-source";
import { cn } from "@/lib/utils";

type RawAssignment = InferSelectModel<typeof assignments>;

// ── 타입 ──────────────────────────────────────────

type Assignment = {
  id: string;
  mediaUrl: string;
  submittedAt: Date | null;
  feedbackCount: number;
};

interface AssignmentViewProps {
  initialAssignments: Assignment[];
  /**
   * true면 이 화면이 캔버스 머리(h1·요약)와 본문 여백·최대 폭을 직접 그린다.
   * 워크스페이스가 자기 머리(h1)를 그리는 동안은 false로 두어 요약과 본문만 그린다.
   */
  pageHeader?: boolean;
}

// ── 헬퍼 ─────────────────────────────────────────

const ASSIGNMENT_LIST_HREF = STUDENT_LEGACY_REDIRECTS.assignments;

function assignmentDetailHref(id: string): string {
  return `/dashboard/student/assignments/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(ASSIGNMENT_LIST_HREF)}`;
}

/** 목록의 제출 시각(Mono): 월·일과 24시간 시각. */
function formatSubmittedAt(date: Date | null): string {
  return formatKst(date, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "제출일 미정");
}

// ── 제출 폼 ──────────────────────────────────────

function SubmitForm({
  inputRef,
  onSuccess,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSuccess: () => Promise<void>;
}) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [state, action, isPending] = useActionState<SubmitAssignmentState, FormData>(
    async (previous, data) => {
      let result: SubmitAssignmentState;
      try {
        result = await submitAssignment(previous, data);
      } catch {
        return { error: "제출 결과를 확인하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요." };
      }
      if (result.success) {
        setMediaUrl("");
        await onSuccess();
      }
      return result;
    },
    {},
  );

  return (
    // 좁은 화면: 입력 → 안내 → 폭 가득 제출(48). 넓은 화면: 입력과 제출이 한 줄(40), 안내는 그 아래.
    <form action={action} className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_auto]">
      <label htmlFor="assignment-media-url" className="text-ui font-semibold text-secondary-foreground md:col-span-2">
        새 믹스셋 제출
      </label>
      <Input
        ref={inputRef}
        id="assignment-media-url"
        name="mediaUrl"
        type="url"
        placeholder="YouTube 또는 SoundCloud 링크 붙여넣기"
        value={mediaUrl}
        onChange={(event) => setMediaUrl(event.target.value)}
        required
        disabled={isPending}
        aria-describedby="assignment-media-url-help"
        className="h-12 px-3.5 md:h-10 md:px-3"
      />
      <p id="assignment-media-url-help" className="text-xs leading-[18px] text-muted-foreground md:order-1 md:col-span-2 md:leading-4">
        YouTube 영상·Shorts·라이브와 SoundCloud 트랙·세트 링크를 지원합니다.
      </p>
      <Button
        type="submit"
        size="touch"
        disabled={isPending}
        className="mt-1 md:mt-0 md:h-10 md:rounded-md md:px-[18px] md:text-body"
      >
        {isPending ? "제출 중..." : "제출"}
      </Button>
      {state.error && <p role="alert" className="text-ui text-destructive md:order-2 md:col-span-2">{state.error}</p>}
      {state.success && <p role="status" className="text-ui text-success md:order-2 md:col-span-2">믹스셋을 제출했습니다.</p>}
    </form>
  );
}

// ── 목록 행 ──────────────────────────────────────

function AssignmentRow({ assignment }: { assignment: Assignment }) {
  const waiting = assignment.feedbackCount === 0;
  const status = waiting ? getPortalStatus("feedbackWaiting").label : `피드백 ${assignment.feedbackCount}개`;
  const submittedAt = formatSubmittedAt(assignment.submittedAt);
  const source = mediaSourceLabel(assignment.mediaUrl);

  return (
    <li>
      <Link
        href={assignmentDetailHref(assignment.id)}
        className="flex min-h-16 items-center gap-3 border-b border-muted py-2.5 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:h-14 md:min-h-0 md:gap-3.5 md:px-1 md:py-0"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-touch bg-muted text-secondary-foreground md:size-8 md:rounded-md"
        >
          <Play className="size-3.5 fill-current" strokeWidth={1.6} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-md font-medium md:text-body">{describeAssignmentMedia(assignment.mediaUrl)}</span>
          <span className="truncate text-xs text-muted-foreground">
            {source}
            <span className="md:hidden"> · <span className="font-mono">{submittedAt}</span></span>
          </span>
        </span>
        <span className="hidden w-[120px] shrink-0 font-mono text-xs text-muted-foreground md:block">{submittedAt}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-ui text-secondary-foreground md:w-[120px]">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", waiting ? "bg-item-qna" : "bg-highlight")} />
          {status}
        </span>
      </Link>
    </li>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function AssignmentView({ initialAssignments, pageHeader = false }: AssignmentViewProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);
  const [refreshError, setRefreshError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [data, fbMap] = await Promise.all([getMyAssignments(), getMyFeedbacksMap()]);
      setAssignments((data as RawAssignment[]).map((a) => ({
        id: a.id, mediaUrl: a.mediaUrl, submittedAt: a.submittedAt, feedbackCount: fbMap[a.id] ?? 0,
      })));
      setRefreshError(false);
      router.refresh();
    } catch {
      setRefreshError(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [router]);

  const waitingCount = assignments.filter((assignment) => assignment.feedbackCount === 0).length;
  const summary = assignments.length > 0
    ? `믹스셋 ${assignments.length}개 · ${getPortalStatus("feedbackWaiting").label} ${waitingCount}개`
    : null;

  const body = (
    <div className={cn("flex flex-col gap-7 md:gap-8", pageHeader && "max-w-[880px]")}>
      {pageHeader ? (
        <header className="flex flex-col gap-1">
          <h1 className="text-mobile-title font-semibold tracking-display md:text-display">과제</h1>
          {summary ? <p className="text-body text-secondary-foreground">{summary}</p> : null}
        </header>
      ) : summary ? (
        <p className="text-body text-secondary-foreground">{summary}</p>
      ) : null}

      <SubmitForm inputRef={inputRef} onSuccess={refresh} />
      {refreshError && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-ui">
        <p>제출은 완료됐지만 목록을 새로 불러오지 못했습니다.</p>
        <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing}>목록 다시 불러오기</Button>
      </div>}

      {assignments.length === 0 ? (
        <EmptyState
          title="제출한 믹스셋이 없습니다"
          description="위 입력란에 YouTube 또는 SoundCloud 링크를 붙여넣어 첫 믹스셋을 제출하세요."
          icon={<FilePlay className="size-4.5" strokeWidth={1.6} aria-hidden="true" />}
          action={(
            <Button type="button" variant="outline" onClick={() => inputRef.current?.focus()}>
              링크 붙여넣기
            </Button>
          )}
        />
      ) : (
        <section aria-labelledby="assignment-list-heading" className="flex flex-col">
          <div className="flex h-11 items-center justify-between border-b border-border md:h-auto md:items-baseline md:pb-2">
            <h2 id="assignment-list-heading" className="text-ui font-semibold text-secondary-foreground">제출한 믹스셋</h2>
            <span className="text-xs text-muted-foreground">최신순</span>
          </div>
          <ul>
            {assignments.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} />)}
          </ul>
        </section>
      )}
    </div>
  );

  return pageHeader ? (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">{body}</div>
  ) : body;
}
