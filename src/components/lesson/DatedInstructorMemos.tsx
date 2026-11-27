"use client";

import { useCallback, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstructorMemoEditor } from "@/components/lesson/InstructorMemoEditor";
import {
  getInstructorMemo,
  type DatedInstructorMemoItem,
  type InstructorMemoSnapshot,
} from "@/lib/actions/instructorMemos";
import { dayKeyFromNumber, dayNumberFromKey } from "@/lib/assignment-recurrence";
import { htmlToPlainText } from "@/lib/assignment-submission";
import { isRichTextEmpty } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "11.27 (목)" — 날짜 키(KST YYYY-MM-DD)를 그대로 읽어 시간대에 흔들리지 않는다. */
export function formatMemoDate(key: string): string {
  const day = dayNumberFromKey(key);
  if (day === null) return key;
  const [, month, date] = key.split("-");
  // dayNumber 0은 1970-01-01(목요일)이다.
  return `${month}.${date} (${WEEKDAYS[(((day + 4) % 7) + 7) % 7]})`;
}

function shiftKey(key: string, days: number): string {
  const day = dayNumberFromKey(key);
  return day === null ? key : dayKeyFromNumber(day + days);
}

/** 목록 미리보기: 태그를 빼고 한 줄로. */
function excerpt(html: string): string {
  return htmlToPlainText(html.replace(/<\/(li|h\d|blockquote)>/giu, " ")).replace(/\s+/gu, " ").trim();
}

/**
 * 노트를 만들지 않고 날짜마다 남기는 학생 메모(관리자만 보기). 진도 체크·다음 수업 참고용(2026-11-27 사용자 요청).
 * 날짜를 고르면 그 날짜 메모를 열고, 아래에 메모를 남긴 날짜를 최근부터 보인다. 레슨 있던 날은 빠르게 고를 수 있다.
 */
export function DatedInstructorMemos({
  studentId,
  studentName,
  actorId,
  today,
  initialMemo,
  initialList,
  lessonDates,
}: {
  studentId: string;
  studentName: string;
  actorId: string;
  /** 서버 시각 기준 오늘(KST YYYY-MM-DD). */
  today: string;
  /** 오늘 날짜 메모. */
  initialMemo: InstructorMemoSnapshot;
  initialList: DatedInstructorMemoItem[];
  /** 레슨이 있던(있을) 날짜 키, 최근 몇 개. */
  lessonDates: string[];
}) {
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState<InstructorMemoSnapshot | null>(initialMemo);
  const [list, setList] = useState(initialList);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const open = useCallback((next: string) => {
    if (dayNumberFromKey(next) === null) return;
    setDate(next);
    setMemo(null);
    setLoadError(null);
    startLoading(async () => {
      try {
        const snapshot = await getInstructorMemo({ kind: "date", studentId, date: next });
        if (snapshot) setMemo(snapshot);
        else setLoadError("이 날짜 메모를 열지 못했습니다.");
      } catch {
        setLoadError("이 날짜 메모를 열지 못했습니다. 다시 골라 주세요.");
      }
    });
  }, [studentId]);

  const handleSaved = useCallback((saved: InstructorMemoSnapshot) => {
    setList((current) => {
      const rest = current.filter((item) => item.date !== date);
      if (isRichTextEmpty(saved.contentHtml)) return rest;
      const next = [...rest, { date, contentHtml: saved.contentHtml, updatedAt: saved.updatedAt ?? new Date() }];
      return next.sort((left, right) => (left.date < right.date ? 1 : -1));
    });
  }, [date]);

  const memoDates = new Set(list.map((item) => item.date));
  const quickDates = [...new Set([today, ...lessonDates])].sort((left, right) => (left < right ? 1 : -1));

  return (
    <section aria-labelledby="dated-memo-heading" className="mt-8 flex max-w-[880px] flex-col gap-3">
      <h2 id="dated-memo-heading" className="inline-flex items-center gap-1.5 text-ui font-semibold text-secondary-foreground">
        <Lock className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        날짜별 메모
        <span className="font-normal text-muted-foreground">· 나만 보기</span>
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="전날" onClick={() => open(shiftKey(date, -1))}>
            <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <label className="inline-flex items-center">
            <span className="sr-only">메모 날짜</span>
            <input
              id="dated-memo-date"
              type="date"
              value={date}
              onChange={(event) => open(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-ui tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <Button type="button" size="icon" variant="ghost" aria-label="다음 날" onClick={() => open(shiftKey(date, 1))}>
            <ChevronRight className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </div>
        <div role="group" aria-label="빠른 날짜" className="flex flex-wrap gap-1.5">
          {quickDates.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => open(key)}
              aria-pressed={key === date}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-xs tabular-nums text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background",
              )}
            >
              {key === today ? "오늘" : formatMemoDate(key)}
              {key !== today && lessonDates.includes(key) ? <span className="sr-only">레슨</span> : null}
              {memoDates.has(key) ? <span aria-label="메모 있음" className="size-1.5 rounded-full bg-current opacity-70" /> : null}
            </button>
          ))}
        </div>
      </div>

      <div aria-busy={loading || memo === null}>
        {memo ? (
          <InstructorMemoEditor
            key={date}
            scope={{ kind: "date", studentId, date }}
            initial={memo}
            actorId={actorId}
            label={`${studentName} ${formatMemoDate(date)} 메모`}
            placeholder="오늘 진도, 잘 된 점·막힌 점, 다음 수업에 볼 것(학생에게 보이지 않음)"
            minHeight="140px"
            onSaved={handleSaved}
          />
        ) : loadError ? (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-ui">
            <span>{loadError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => open(date)}>다시 열기</Button>
          </div>
        ) : (
          <div className="h-[140px] animate-pulse rounded-md border border-border bg-muted/40" />
        )}
      </div>

      {list.length > 0 ? (
        <ul aria-label="메모 남긴 날짜" className="flex flex-col divide-y divide-border rounded-md border border-border">
          {list.map((item) => (
            <li key={item.date}>
              <button
                type="button"
                onClick={() => open(item.date)}
                aria-current={item.date === date ? "date" : undefined}
                className="flex min-h-11 w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=date]:bg-muted"
              >
                <span className="w-[5.5rem] shrink-0 text-xs font-medium tabular-nums text-secondary-foreground">
                  {formatMemoDate(item.date)}
                </span>
                <span className="line-clamp-1 min-w-0 text-ui text-muted-foreground">{excerpt(item.contentHtml) || "내용 없음"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-muted-foreground">아직 남긴 날짜 메모가 없습니다. 수업한 날을 골라 진도와 다음 수업 메모를 남겨 두세요.</p>
      )}
    </section>
  );
}
