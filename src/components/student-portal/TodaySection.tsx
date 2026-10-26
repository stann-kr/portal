"use client";

import Link from "next/link";
import { formatKst } from "@/lib/kst-format";
import { buildNoteCreateHref } from "@/lib/note-create-route";
import { buildQnaListHref } from "@/lib/qna-routes";
import {
  getStudentRecentNotes,
  getStudentTodayAgenda,
  getStudentTodaySummary,
  getStudentTodoEntries,
  getStudentUpcomingSchedule,
  toKstDayKey,
} from "@/lib/student-today";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { cn } from "@/lib/utils";
import { AgendaRow } from "./today/AgendaRow";
import { formatAgendaWhen, formatHomeTime, formatKstDot, formatUpcomingDay } from "./today/format";
import {
  LEDGER_HEADER_LINK_CLASS,
  LEDGER_HEADER_NOTE_CLASS,
  LEDGER_INLINE_LINK_CLASS,
  LEDGER_ROW_CLASS,
  LedgerEmptyRow,
  LedgerSection,
  LedgerSectionHeader,
} from "./today/HomeSection";
import { QuickActions } from "./today/QuickActions";
import { RecentNotesList } from "./today/RecentNotesList";
import { TodoList } from "./today/TodoList";
import { WithinPageLink } from "./today/WithinPageLink";

type Post = {
  id: string;
  title: string;
  isPinned: boolean;
  createdAt: Date | null;
};

const TODAY_PATH = "/dashboard/student?section=today";
const CALENDAR_HREF = "/dashboard/student?section=workspace";
const NOTES_HREF = "/dashboard/student/notes";
const ANNOUNCEMENTS_HREF = "/community?boardType=ANNOUNCEMENT";

/**
 * 좁은 화면은 한 줄(오늘 → 할 일 → 최근 노트 → 다가오는 일정 → 공지), 넓은 화면은 두 열(Main·MobileHome 보드).
 * 좁은 화면에서 두 열 묶음을 풀고(`contents`) 구역 순서만 바꾼다.
 */
const COLUMN_CLASS = "contents md:flex md:min-w-0 md:flex-col md:gap-10";

function formatDay(date: Date) {
  return formatKst(date, { month: "long", day: "numeric", weekday: "long" });
}

export function TodaySection({
  announcements,
  unifiedItems,
  displayName,
  referenceTime,
}: {
  announcements: Post[];
  unifiedItems: UnifiedItem[];
  displayName: string;
  referenceTime: Date;
}) {
  const todayKey = toKstDayKey(referenceTime);
  const summary = getStudentTodaySummary(unifiedItems, referenceTime);
  const agenda = getStudentTodayAgenda(unifiedItems, referenceTime);
  const upcoming = getStudentUpcomingSchedule(unifiedItems, referenceTime);
  const recentNotes = getStudentRecentNotes(unifiedItems, referenceTime, 5);
  const todoEntries = getStudentTodoEntries(summary);
  const recentAnnouncements = [...announcements]
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    })
    .slice(0, 3);
  const safeName = displayName.trim() || "학생";
  const todayNoteHref = buildNoteCreateHref({
    pathname: "/dashboard/student/notes/new",
    defaultDate: todayKey,
    returnTo: TODAY_PATH,
    returnFallback: TODAY_PATH,
  });
  const newNoteHref = buildNoteCreateHref({
    pathname: "/dashboard/student/notes/new",
    returnTo: TODAY_PATH,
    returnFallback: TODAY_PATH,
  });
  // 오늘 레슨은 이미 오늘 목록에 있으므로 요약에는 오늘 이후의 다음 레슨만 덧붙인다.
  // 외부 캘린더 일정은 subType이 LESSON으로 들어오므로 포털 레슨만 레슨으로 부른다.
  const nextLesson =
    summary.nextCue?.subType === "LESSON"
    && summary.nextCue.source.kind === "PORTAL"
    && toKstDayKey(summary.nextCue.date) !== todayKey
      ? summary.nextCue
      : null;
  const summaryParts = [
    agenda.length > 0 ? `오늘 항목 ${agenda.length}개` : "오늘은 예정된 항목이 없습니다",
    todoEntries.length > 0 ? `확인할 일 ${todoEntries.length}개` : null,
  ].filter(Boolean);
  const nextLessonLong = nextLesson
    ? `${formatKst(nextLesson.date, { month: "long", day: "numeric", weekday: "short" })} ${formatHomeTime(nextLesson.date)}`
    : null;

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <div className="flex max-w-[1040px] flex-col gap-7 md:gap-10">
        <header className="flex flex-col gap-1.5 md:gap-2">
          <p className="font-mono text-xs text-muted-foreground">{formatDay(referenceTime)}</p>
          <h1 className="break-words text-mobile-title font-semibold tracking-display text-foreground md:text-display">
            {safeName}님, 오늘의 흐름입니다.
          </h1>
          <p className="text-body text-secondary-foreground">
            {summaryParts.join(" · ")}
            {nextLessonLong ? <span className="hidden md:inline"> · 다음 레슨 {nextLessonLong}</span> : null}
          </p>
          {nextLesson ? (
            <p className="mt-1 flex items-center gap-2 text-ui text-secondary-foreground md:hidden">
              <span className="size-1.5 shrink-0 rounded-full bg-event-lesson" aria-hidden="true" />
              다음 레슨
              <span className="font-mono text-xs text-foreground">
                {formatKstDot(nextLesson.date, { weekday: true, time: true, referenceTime })}
              </span>
            </p>
          ) : null}
          <QuickActions newNoteHref={newNoteHref} returnTo={TODAY_PATH} />
        </header>

        <div className="flex flex-col gap-7 md:flex-row md:flex-wrap md:items-start md:gap-x-14 md:gap-y-12">
          <div className={cn(COLUMN_CLASS, "md:flex-[2_1_480px]")}>
            <LedgerSection labelledBy="today-agenda-heading" className="order-1 md:order-none">
              <LedgerSectionHeader
                id="today-agenda-heading"
                title="오늘"
                count={agenda.length > 0 ? agenda.length : undefined}
                aside={
                  <WithinPageLink href={CALENDAR_HREF} className={LEDGER_HEADER_LINK_CLASS}>
                    <span className="md:hidden">캘린더</span>
                    <span className="hidden md:inline">캘린더 열기</span>
                  </WithinPageLink>
                }
              />
              {agenda.length === 0 ? (
                <LedgerEmptyRow
                  actions={<Link href={todayNoteHref} className={LEDGER_INLINE_LINK_CLASS}>오늘 노트 쓰기</Link>}
                >
                  오늘 예정된 일정이나 노트가 없습니다.
                </LedgerEmptyRow>
              ) : (
                <ol>
                  {agenda.map((entry) => (
                    <li key={`${entry.item.source.kind}:${entry.item.source.entity}:${entry.item.id}`}>
                      <AgendaRow
                        entry={entry}
                        when={formatAgendaWhen(entry)}
                        calendarHref={CALENDAR_HREF}
                        returnTo={TODAY_PATH}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </LedgerSection>

            <LedgerSection labelledBy="upcoming-heading" className="order-4 md:order-none">
              <LedgerSectionHeader
                id="upcoming-heading"
                title="다가오는 일정"
                aside={<span className={LEDGER_HEADER_NOTE_CLASS}>7일</span>}
              />
              {upcoming.groups.length === 0 ? (
                <LedgerEmptyRow>앞으로 7일 동안 예정된 일정이 없습니다.</LedgerEmptyRow>
              ) : (
                <>
                  {upcoming.groups.map((group) => {
                    const headingId = `upcoming-day-${group.dayKey}`;
                    return (
                      <div key={group.dayKey} className="flex flex-col pt-3">
                        <h3 id={headingId} className="mb-0.5 text-xs font-normal text-muted-foreground md:px-1">
                          {formatUpcomingDay(group.dayKey, group.offset)}
                        </h3>
                        <ol aria-labelledby={headingId}>
                          {group.entries.map((entry) => (
                            <li key={`${entry.item.source.kind}:${entry.item.source.entity}:${entry.item.id}`}>
                              <AgendaRow
                                entry={entry}
                                when={formatAgendaWhen(entry)}
                                calendarHref={CALENDAR_HREF}
                                returnTo={TODAY_PATH}
                                variant="upcoming"
                              />
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  })}
                  {upcoming.totalCount > upcoming.shownCount ? (
                    <p className="pt-2 text-xs text-muted-foreground md:px-1">
                      외 {upcoming.totalCount - upcoming.shownCount}개 일정은{" "}
                      <WithinPageLink href={CALENDAR_HREF} className="underline underline-offset-4 hover:text-foreground">
                        캘린더
                      </WithinPageLink>
                      에서 확인할 수 있습니다.
                    </p>
                  ) : null}
                </>
              )}
            </LedgerSection>

            <LedgerSection labelledBy="recent-notes-heading" className="order-3 md:order-none">
              <LedgerSectionHeader
                id="recent-notes-heading"
                title="최근 노트"
                aside={<Link href={NOTES_HREF} className={LEDGER_HEADER_LINK_CLASS}>모든 노트</Link>}
              />
              {recentNotes.length === 0 ? <LedgerEmptyRow>아직 작성한 노트가 없습니다.</LedgerEmptyRow> : null}
              <RecentNotesList
                notes={recentNotes}
                referenceTime={referenceTime}
                returnTo={TODAY_PATH}
                newNoteHref={newNoteHref}
              />
            </LedgerSection>
          </div>

          <div className={cn(COLUMN_CLASS, "md:flex-[1_1_280px]")}>
            <LedgerSection labelledBy="todo-heading" className="order-2 md:order-none">
              <LedgerSectionHeader
                id="todo-heading"
                title="할 일"
                count={todoEntries.length > 0 ? todoEntries.length : undefined}
                aside={
                  <Link href={buildQnaListHref(TODAY_PATH)} className={cn(LEDGER_HEADER_LINK_CLASS, "hidden md:flex")}>
                    전체 Q&A
                  </Link>
                }
              />
              {todoEntries.length === 0 ? (
                <LedgerEmptyRow>지금 확인할 피드백이나 질문이 없습니다.</LedgerEmptyRow>
              ) : (
                <TodoList entries={todoEntries} referenceTime={referenceTime} returnTo={TODAY_PATH} />
              )}
            </LedgerSection>

            <LedgerSection labelledBy="announcement-heading" className="order-5 md:order-none">
              <LedgerSectionHeader
                id="announcement-heading"
                title="공지"
                aside={<Link href={ANNOUNCEMENTS_HREF} className={LEDGER_HEADER_LINK_CLASS}>전체</Link>}
              />
              {recentAnnouncements.length === 0 ? (
                <LedgerEmptyRow>등록된 공지가 없습니다.</LedgerEmptyRow>
              ) : (
                <ul>
                  {recentAnnouncements.map((post) => {
                    const date = formatKstDot(post.createdAt, { referenceTime });
                    return (
                      <li key={post.id}>
                        <Link
                          href={`/community/${post.id}?returnTo=${encodeURIComponent(TODAY_PATH)}`}
                          className={cn(LEDGER_ROW_CLASS, "flex flex-col gap-0.5 py-3 md:px-1")}
                        >
                          <span className="line-clamp-2 break-words text-md md:text-body">{post.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {post.isPinned ? `고정${date ? " · " : ""}` : null}
                            <span className="font-mono">{date}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </LedgerSection>
          </div>
        </div>
      </div>
    </div>
  );
}
