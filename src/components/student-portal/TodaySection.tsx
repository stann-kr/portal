"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  CircleCheck,
  Megaphone,
  NotebookPen,
  Sun,
} from "lucide-react";
import { formatKst, formatKstShortDate } from "@/lib/kst-format";
import { buildNoteCreateHref } from "@/lib/note-create-route";
import {
  getStudentRecentNotes,
  getStudentTodayAgenda,
  getStudentTodaySummary,
  getStudentTodoEntries,
  getStudentUpcomingSchedule,
  toKstDayKey,
} from "@/lib/student-today";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { AgendaRow } from "./today/AgendaRow";
import { formatAgendaWhen, formatHomeTime, formatUpcomingDay } from "./today/format";
import { HOME_ACTION_LINK_CLASS, HOME_ROW_CLASS, HomeEmptyRow, HomeSection } from "./today/HomeSection";
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
const CALENDAR_HREF = "/dashboard/student?section=workspace&view=calendar";
const NOTES_HREF = "/dashboard/student/notes";

function formatDay(date: Date) {
  return formatKst(date, { month: "long", day: "numeric", weekday: "long" });
}

function nextLessonLabel(item: UnifiedItem) {
  return `${formatKst(item.date, { month: "long", day: "numeric", weekday: "short" })} ${formatHomeTime(item.date)}`;
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
  const todayEventCount = agenda.filter((entry) => entry.kind !== "note").length;
  // 오늘 레슨은 이미 오늘 목록에 있으므로 요약에는 오늘 이후의 다음 레슨만 덧붙인다.
  // 외부 캘린더 일정은 subType이 LESSON으로 들어오므로 포털 레슨만 레슨으로 부른다.
  const nextLesson =
    summary.nextCue?.subType === "LESSON"
    && summary.nextCue.source.kind === "PORTAL"
    && toKstDayKey(summary.nextCue.date) !== todayKey
      ? summary.nextCue
      : null;
  const summaryParts = [
    todayEventCount > 0 ? `오늘 일정 ${todayEventCount}개` : "오늘은 예정된 일정이 없습니다",
    todoEntries.length > 0 ? `확인할 항목 ${todoEntries.length}개` : null,
    nextLesson ? `다음 레슨 ${nextLessonLabel(nextLesson)}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <header className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{formatDay(referenceTime)}</p>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-[-0.02em] text-foreground">
            {safeName}님, 오늘의 흐름입니다.
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{summaryParts.join(" · ")}</p>
        </div>
        <QuickActions newNoteHref={newNoteHref} calendarHref={CALENDAR_HREF} returnTo={TODAY_PATH} />
      </header>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-8">
          <HomeSection
            id="today-agenda-heading"
            title="오늘"
            icon={Sun}
            action={
              agenda.length > 0 ? (
                <Link href={todayNoteHref} className={HOME_ACTION_LINK_CLASS}>
                  오늘 노트 쓰기
                </Link>
              ) : null
            }
          >
            {agenda.length === 0 ? (
              <HomeEmptyRow
                actions={
                  <>
                    <Link href={todayNoteHref} className={HOME_ACTION_LINK_CLASS}>오늘 노트 쓰기</Link>
                    <WithinPageLink href={CALENDAR_HREF} className={HOME_ACTION_LINK_CLASS}>일정 보기</WithinPageLink>
                  </>
                }
              >
                오늘 예정된 일정이나 노트가 없습니다.
              </HomeEmptyRow>
            ) : (
              <ol className="space-y-0.5">
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
          </HomeSection>

          <HomeSection
            id="upcoming-heading"
            title="다가오는 일정"
            icon={CalendarRange}
            action={
              <WithinPageLink href={CALENDAR_HREF} className={HOME_ACTION_LINK_CLASS}>
                캘린더에서 보기
                <ArrowRight className="size-3" aria-hidden="true" />
              </WithinPageLink>
            }
          >
            {upcoming.groups.length === 0 ? (
              <HomeEmptyRow>앞으로 7일 동안 예정된 일정이 없습니다.</HomeEmptyRow>
            ) : (
              <div className="space-y-3">
                {upcoming.groups.map((group) => {
                  const headingId = `upcoming-day-${group.dayKey}`;
                  return (
                    <div key={group.dayKey}>
                      <h3 id={headingId} className="px-2 pb-0.5 pt-1 text-xs font-medium text-muted-foreground">
                        {formatUpcomingDay(group.dayKey, group.offset)}
                      </h3>
                      <ol aria-labelledby={headingId} className="space-y-0.5">
                        {group.entries.map((entry) => (
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
                    </div>
                  );
                })}
                {upcoming.totalCount > upcoming.shownCount ? (
                  <p className="px-2 text-xs text-muted-foreground">
                    외 {upcoming.totalCount - upcoming.shownCount}개 일정은 캘린더에서 확인할 수 있습니다.
                  </p>
                ) : null}
              </div>
            )}
          </HomeSection>

          <HomeSection
            id="recent-notes-heading"
            title="최근 노트"
            icon={NotebookPen}
            action={
              <Link href={NOTES_HREF} className={HOME_ACTION_LINK_CLASS}>
                모든 노트
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            }
          >
            {recentNotes.length === 0 ? (
              <HomeEmptyRow>아직 작성한 노트가 없습니다.</HomeEmptyRow>
            ) : null}
            <RecentNotesList
              notes={recentNotes}
              referenceTime={referenceTime}
              returnTo={TODAY_PATH}
              newNoteHref={newNoteHref}
            />
          </HomeSection>
        </div>

        <div className="min-w-0 space-y-8">
          <HomeSection id="todo-heading" title="할 일" icon={CircleCheck}>
            {todoEntries.length === 0 ? (
              <HomeEmptyRow>지금 확인할 피드백이나 질문이 없습니다.</HomeEmptyRow>
            ) : (
              <TodoList entries={todoEntries} referenceTime={referenceTime} returnTo={TODAY_PATH} />
            )}
          </HomeSection>

          <HomeSection id="announcement-heading" title="최근 공지" icon={Megaphone}>
            {recentAnnouncements.length === 0 ? (
              <HomeEmptyRow>등록된 공지가 없습니다.</HomeEmptyRow>
            ) : (
              <ul className="space-y-0.5">
                {recentAnnouncements.map((post) => (
                  <li key={post.id}>
                    <Link
                      href={`/community/${post.id}?returnTo=${encodeURIComponent(TODAY_PATH)}`}
                      className={`${HOME_ROW_CLASS} items-start`}
                    >
                      <span className="min-w-0 flex-1 line-clamp-2 break-words text-foreground">{post.title}</span>
                      <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                        {post.isPinned ? "고정" : formatKstShortDate(post.createdAt, "", referenceTime)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </HomeSection>
        </div>
      </div>
    </div>
  );
}
