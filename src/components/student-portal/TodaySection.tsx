"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  FileText,
  HelpCircle,
  ListMusic,
  MessageSquareText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStudentTodaySummary } from "@/lib/student-today";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

type Post = {
  id: string;
  title: string;
  isPinned: boolean;
  createdAt: Date | null;
};

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatCueDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(date: Date | null) {
  if (!date) return null;

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
  }).format(date);
}

function cueTypeLabel(item: UnifiedItem) {
  if (item.subType === "LESSON") return "다음 레슨";
  if (item.subType === "PRACTICE") return "다음 연습";
  if (item.subType === "GIG") return "다음 공연·행사";
  return "다음 일정";
}

export function TodaySection({
  announcements,
  unifiedItems,
  displayName,
  referenceTime,
  onOpenWorkspace,
}: {
  announcements: Post[];
  unifiedItems: UnifiedItem[];
  displayName: string;
  referenceTime: Date;
  onOpenWorkspace: () => void;
}) {
  const summary = getStudentTodaySummary(unifiedItems, referenceTime);
  const priorityItems = [
    ...summary.feedbackItems.map((item) => ({ item, status: "feedbackReady" as const })),
    ...summary.answeredQnaItems.map((item) => ({ item, status: "qnaAnswered" as const })),
    ...(summary.waitingAssignment
      ? [{ item: summary.waitingAssignment, status: "feedbackWaiting" as const }]
      : []),
    ...summary.openQnaItems.map((item) => ({ item, status: "qnaOpen" as const })),
  ].slice(0, 5);
  const recentAnnouncements = [...announcements]
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    })
    .slice(0, 3);
  const safeName = displayName.trim() || "학생";

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div>
        <p className="text-sm text-muted-foreground">{formatDay(referenceTime)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
          {safeName}님, 오늘의 흐름입니다.
        </h1>
      </div>

      <section aria-labelledby="next-cue-heading">
        {summary.nextCue ? (
          <div className="grid gap-6 rounded-lg border border-primary/25 bg-surface p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary" id="next-cue-heading">
                {cueTypeLabel(summary.nextCue)}
              </p>
              <p className="mt-3 text-xl font-semibold leading-snug tracking-[-0.02em] text-foreground sm:text-2xl">
                {summary.nextCue.title}
              </p>
              <p className="mt-2 font-mono text-sm tabular-nums text-muted-foreground">
                {formatCueDate(summary.nextCue.date)}
              </p>
              {summary.nextCue.description ? (
                <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted-foreground">
                  {summary.nextCue.description}
                </p>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={onOpenWorkspace}>
              워크스페이스 열기
              <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <EmptyState
            title="예정된 일정이 없습니다"
            description="워크스페이스에서 다음 레슨이나 연습 일정을 기록할 수 있습니다."
            action={
              <Button type="button" variant="outline" onClick={onOpenWorkspace}>
                일정 추가하기
              </Button>
            }
            icon={<CalendarDays className="size-4" aria-hidden="true" />}
          />
        )}
      </section>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <section aria-labelledby="priority-heading" className="min-w-0">
          <SectionHeader
            title="확인할 항목"
            description="현재 기록된 피드백과 질문 상태만 보여줍니다."
            className="mb-4"
          />
          {priorityItems.length === 0 ? (
            <EmptyState
              title="지금 확인할 항목이 없습니다"
              description="피드백이 등록되거나 질문 상태가 바뀌면 이곳에 표시됩니다."
              icon={<MessageSquareText className="size-4" aria-hidden="true" />}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {priorityItems.map(({ item, status }, index) => {
                const isAssignment = item.type === "ASSIGNMENT";
                const href = isAssignment
                  ? `/dashboard/student/assignments/${item.id}`
                  : `/dashboard/qna/${item.id}`;
                const title = isAssignment ? "제출한 믹스셋" : item.title;

                return (
                  <Link
                    key={`${item.type}-${item.id}`}
                    href={href}
                    className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted focus-visible:bg-muted sm:px-5 ${
                      index > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{title}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {isAssignment ? item.title : formatShortDate(item.date)}
                      </p>
                    </div>
                    <StatusBadge status={status} />
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="quick-record-heading" className="min-w-0">
          <SectionHeader
            title="빠른 기록"
            description="생각이 사라지기 전에 바로 남겨보세요."
            className="mb-4"
          />
          <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1">
            <Button asChild variant="outline" className="h-auto justify-start px-4 py-3">
              <Link href="/dashboard/student/notes/new">
                <FileText className="mr-2 size-4 text-primary" aria-hidden="true" />
                노트 작성
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto justify-start px-4 py-3">
              <Link href="/dashboard/qna/new">
                <HelpCircle className="mr-2 size-4 text-primary" aria-hidden="true" />
                질문 작성
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start px-4 py-3"
              onClick={onOpenWorkspace}
            >
              <ListMusic className="mr-2 size-4 text-primary" aria-hidden="true" />
              일정·디깅 열기
            </Button>
          </div>
        </section>
      </div>

      <section aria-labelledby="announcement-heading">
        <SectionHeader title="최근 공지" className="mb-4" />
        {recentAnnouncements.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
            등록된 공지가 없습니다.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {recentAnnouncements.map((post) => (
              <Link
                key={post.id}
                href={`/community/${post.id}`}
                className="group min-w-0 rounded-lg border border-border bg-surface px-4 py-4 transition-[border-color,background-color,transform] hover:border-primary/30 hover:bg-accent/40 active:translate-y-px"
              >
                <p className="line-clamp-2 text-sm font-semibold leading-6 text-foreground">
                  {post.title}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{post.isPinned ? "고정 공지" : formatShortDate(post.createdAt)}</span>
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
