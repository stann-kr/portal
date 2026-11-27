"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { buildAdminMemoHref } from "@/components/app-shell/navigation";
import { InstructorMemoEditor } from "@/components/lesson/InstructorMemoEditor";
import { formatMemoDate, memoExcerpt, shiftMemoDateKey } from "@/components/lesson/DatedInstructorMemos";
import {
  LEDGER_ROW_CLASS,
  LedgerEmptyRow,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";
import { buttonClassName } from "@/components/ui/button";
import type { AdminMemoBoard as AdminMemoBoardData, AdminMemoBoardEntry } from "@/lib/actions/instructorMemos";
import { dayNumberFromKey } from "@/lib/assignment-recurrence";
import { formatKstClock } from "@/lib/kst-format";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";
import { cn } from "@/lib/utils";

const CHIP_CLASS = cn(
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-ui text-secondary-foreground transition-colors duration-[var(--duration-fast)]",
  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
  "aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:text-background",
);

function EntryRow({
  entry,
  label,
  showDate,
  today,
  current,
}: {
  entry: AdminMemoBoardEntry;
  label: string;
  showDate: boolean;
  today: string;
  current: boolean;
}) {
  return (
    <li>
      <Link
        href={buildAdminMemoHref({ date: entry.date, studentId: entry.studentId, today })}
        aria-current={current ? "true" : undefined}
        className={cn(LEDGER_ROW_CLASS, "flex min-w-0 items-center gap-3 py-3 md:px-1 aria-[current=true]:bg-sidebar")}
      >
        {showDate ? (
          <span className="w-18 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatMemoDate(entry.date)}</span>
        ) : null}
        <span className="shrink-0 text-ui font-medium">{label}</span>
        <span className="line-clamp-1 min-w-0 text-ui text-muted-foreground">{memoExcerpt(entry.contentHtml) || "내용 없음"}</span>
      </Link>
    </li>
  );
}

/**
 * 관리자 "메모" 화면 본문(캔버스 MemoNav1127 ①). 날짜를 먼저 고르고 그날 레슨 학생부터 한 번에 고른다.
 * 날짜·학생은 주소(`?date=&student=`)에 둬 새로고침·뒤로가기가 같은 자리를 연다. 저장하면 목록과 점을 다시 받는다.
 */
export function AdminMemoBoard({ board, actorId }: { board: AdminMemoBoardData; actorId: string }) {
  const router = useProgressRouter();
  const { date, today, students, selectedStudentId, memo, dayEntries, recentEntries } = board;
  const labels = new Map(students.map((student) => [student.id, student.label]));
  const label = (id: string) => labels.get(id) ?? "학생";
  const selected = selectedStudentId ? students.find((student) => student.id === selectedStudentId) ?? null : null;
  const lessonStudents = students.filter((student) => student.lessonAt);
  const otherStudents = students.filter((student) => !student.lessonAt);
  const href = (next: { date?: string; studentId?: string | null }) =>
    buildAdminMemoHref({ date: next.date ?? date, studentId: next.studentId === undefined ? selectedStudentId : next.studentId, today });

  const handleSaved = useCallback(() => router.refresh(), [router]);

  const chip = (student: (typeof students)[number]) => (
    <Link key={student.id} href={href({ studentId: student.id })} aria-current={student.id === selectedStudentId ? "true" : undefined} className={CHIP_CLASS}>
      {student.label}
      {student.lessonAt ? (
        <span className="font-mono text-xs tabular-nums opacity-70">{formatKstClock(student.lessonAt)}</span>
      ) : null}
      {student.hasMemo ? <span aria-label="메모 있음" className="size-1.5 rounded-full bg-current opacity-70" /> : null}
    </Link>
  );

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3 md:border-b md:border-border md:pb-3">
        <p className="text-ui text-secondary-foreground">
          <span className="font-medium text-foreground">{formatMemoDate(date)}</span>
          {date === today ? " · 오늘" : null}
          <span className="text-muted-foreground"> · 레슨 {lessonStudents.length}명 · 메모 {dayEntries.length}</span>
        </p>
        <div className="flex items-center gap-1">
          <Link href={href({ date: shiftMemoDateKey(date, -1) })} aria-label="전날" className={buttonClassName({ variant: "ghost", size: "icon" })}>
            <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </Link>
          <label className="inline-flex items-center">
            <span className="sr-only">메모 날짜</span>
            <input
              id="admin-memo-date"
              type="date"
              value={date}
              onChange={(event) => {
                if (dayNumberFromKey(event.target.value) !== null) router.push(href({ date: event.target.value }));
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-ui tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <Link href={href({ date: shiftMemoDateKey(date, 1) })} aria-label="다음 날" className={buttonClassName({ variant: "ghost", size: "icon" })}>
            <ChevronRight className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </Link>
          {date !== today ? (
            <Link href={href({ date: today })} className={buttonClassName({ variant: "ghost", size: "sm" })}>오늘</Link>
          ) : null}
        </div>
      </div>

      <nav aria-label="학생 고르기" className="flex flex-col gap-2">
        {students.length === 0 ? (
          <p className="text-body text-muted-foreground">수강 중인 학생이 없습니다.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {lessonStudents.map(chip)}
            {lessonStudents.length > 0 && otherStudents.length > 0 ? (
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            ) : null}
            {otherStudents.map(chip)}
          </div>
        )}
      </nav>

      {selected && memo ? (
        <section aria-labelledby="admin-memo-editor-heading" className="flex max-w-[880px] flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="admin-memo-editor-heading" className="text-body font-semibold">
              {selected.label} · {formatMemoDate(date)}
            </h2>
            <Link
              href={buildAdminStudentDetailHref(selected.id, "overview")}
              className="text-xs text-secondary-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              학생 상세
            </Link>
          </div>
          <InstructorMemoEditor
            key={`${selected.id}:${date}`}
            scope={{ kind: "date", studentId: selected.id, date }}
            initial={memo}
            actorId={actorId}
            label={`${selected.label} ${formatMemoDate(date)} 메모`}
            placeholder="오늘 진도, 다음 수업에서 이어갈 것(학생에게 보이지 않음)"
            minHeight="160px"
            onSaved={handleSaved}
          />
        </section>
      ) : students.length > 0 ? (
        <p className="text-body text-muted-foreground">학생을 고르면 이 날짜 메모를 바로 씁니다.</p>
      ) : null}

      <div className="grid gap-7 md:grid-cols-2">
        <LedgerSection labelledBy="admin-memo-day-heading">
          <LedgerSectionHeader id="admin-memo-day-heading" title="이 날 남긴 메모" count={dayEntries.length} />
          {dayEntries.length === 0 ? (
            <LedgerEmptyRow>이 날 남긴 메모가 없습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {dayEntries.map((entry) => (
                <EntryRow
                  key={entry.studentId}
                  entry={entry}
                  label={label(entry.studentId)}
                  showDate={false}
                  today={today}
                  current={entry.studentId === selectedStudentId}
                />
              ))}
            </ul>
          )}
        </LedgerSection>
        <LedgerSection labelledBy="admin-memo-recent-heading">
          <LedgerSectionHeader id="admin-memo-recent-heading" title="최근 메모" />
          {recentEntries.length === 0 ? (
            <LedgerEmptyRow>아직 남긴 날짜 메모가 없습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {recentEntries.map((entry) => (
                <EntryRow
                  key={`${entry.studentId}:${entry.date}`}
                  entry={entry}
                  label={label(entry.studentId)}
                  showDate
                  today={today}
                  current={entry.studentId === selectedStudentId && entry.date === date}
                />
              ))}
            </ul>
          )}
        </LedgerSection>
      </div>
    </div>
  );
}
