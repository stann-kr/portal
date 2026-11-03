"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Flag, Lock, Pause, Play, RotateCcw, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstructorMemoSnapshot } from "@/lib/actions/instructorMemos";
import { cn } from "@/lib/utils";
import { InstructorMemoEditor } from "./InstructorMemoEditor";
import {
  insertLessonLine,
  lessonTargetEditor,
  lessonTargetOf,
  type LessonInsertTarget,
} from "./lesson-insert";
import { formatLessonClock, lessonTimestampText, lessonTrackText } from "./lesson-timestamps";
import { lessonTimerScope, useLessonTimer } from "./useLessonTimer";

export type InstructorLessonPanelProps = {
  /** null이면 아직 만들지 않은 새 노트다. 첫 저장으로 id가 생기면 이 수업 메모를 쓸 수 있다. */
  noteId: string | null;
  studentId: string;
  studentName: string;
  actorId: string;
  /** 새 노트는 서버에 메모가 없으므로 null을 넘긴다. */
  noteMemo: InstructorMemoSnapshot | null;
  studentMemo: InstructorMemoSnapshot;
  /** 좁은 화면에서 서랍으로 열려 있는지(넓은 화면은 늘 옆에 둔다). */
  open: boolean;
  onClose: () => void;
};

const TARGET_LABEL: Record<LessonInsertTarget, string> = { note: "노트", memo: "메모" };

/** Alt(Option)와 함께 누르는 키. 입력 중에도 쓰도록 편집기보다 먼저 받는다. */
const SHORTCUTS = { stamp: "KeyT", track: "KeyN", toggle: "KeyP" } as const;

const EMPTY_MEMO: InstructorMemoSnapshot = { memoId: null, contentHtml: "", version: 0, updatedAt: null };

/**
 * 관리자 수업 도구(노트 옆 패널). 믹스 타이머로 `[12:34]` 시점과 `▸ 트랙 N` 줄을 마지막으로 쓰던 편집기(노트·메모)에 넣고,
 * 이 수업 메모와 학생 메모를 둔다. 이 패널의 내용은 학생에게 보내지 않는다.
 */
export function InstructorLessonPanel({
  noteId,
  studentId,
  studentName,
  actorId,
  noteMemo,
  studentMemo,
  open,
  onClose,
}: InstructorLessonPanelProps) {
  const headingId = useId();
  const timer = useLessonTimer(lessonTimerScope(noteId, studentId));
  const [tab, setTab] = useState<"note" | "student">("note");
  const [target, setTarget] = useState<LessonInsertTarget>("note");
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef(timer);
  const targetRef = useRef(target);
  const tabRef = useRef(tab);
  useEffect(() => {
    timerRef.current = timer;
    targetRef.current = target;
    tabRef.current = tab;
  });

  // 마지막으로 초점을 둔 편집기를 넣을 곳으로 기억한다.
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const next = lessonTargetOf(event.target instanceof Element ? event.target : null);
      if (next) setTarget(next);
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);

  const insert = (text: string, options?: { bold?: boolean }) => {
    const preferred = targetRef.current;
    // 메모는 지금 보이는 탭의 편집기에 넣는다(두 메모가 모두 열려 있다).
    const rootOf = (kind: LessonInsertTarget) => (kind === "memo" ? document.getElementById(`${headingId}-${tabRef.current}`) : null) ?? document;
    const fallback = preferred === "note" ? "memo" : "note";
    const editor = lessonTargetEditor(rootOf(preferred), preferred) ?? lessonTargetEditor(rootOf(fallback), fallback);
    if (!editor) {
      setNotice("넣을 편집기가 아직 준비되지 않았습니다.");
      return;
    }
    setNotice(null);
    insertLessonLine(editor, text, options);
  };

  const stamp = () => {
    const current = timerRef.current;
    // 시작 전에 찍으면 그 순간을 믹스 시작으로 삼는다.
    if (!current.running && !current.started) current.toggle();
    insert(lessonTimestampText(current.started ? current.readSeconds() : 0));
  };
  const nextTrack = () => {
    const track = timerRef.current.takeTrack();
    const seconds = timerRef.current.started ? timerRef.current.readSeconds() : null;
    insert(seconds === null ? lessonTrackText(track) : `${lessonTrackText(track)} ${lessonTimestampText(seconds)}`, { bold: true });
  };

  const actionsRef = useRef({ stamp, nextTrack });
  useEffect(() => {
    actionsRef.current = { stamp, nextTrack };
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) return;
      if (event.code === SHORTCUTS.stamp) actionsRef.current.stamp();
      else if (event.code === SHORTCUTS.track) actionsRef.current.nextTrack();
      else if (event.code === SHORTCUTS.toggle) timerRef.current.toggle();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, []);

  return (
    <aside
      aria-labelledby={headingId}
      className={cn(
        "z-40 flex-col gap-5 overflow-y-auto border-border bg-background p-4",
        // 좁은 화면: 아래에서 올라오는 서랍, 중간 화면: 오른쪽 서랍, 넓은 화면: 노트 옆 고정 칸
        "fixed inset-x-0 bottom-0 max-h-[78dvh] rounded-t-xl border-t shadow-lg",
        "md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[360px] md:rounded-none md:border-l md:border-t-0",
        "xl:sticky xl:top-0 xl:z-auto xl:h-dvh xl:w-[340px] xl:shrink-0 xl:shadow-none",
        open ? "flex" : "hidden xl:flex",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Lock className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          수업 도구
          <span className="text-xs font-normal text-muted-foreground">· 나만 보기</span>
        </h2>
        <Button type="button" variant="ghost" size="icon" className="xl:hidden" onClick={onClose} aria-label="수업 도구 닫기">
          <X className="size-4" strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </div>

      <section aria-label="믹스 타이머" className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Timer className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            믹스 시간
          </span>
          <span role="timer" aria-live="off" className="font-mono text-2xl tabular-nums text-foreground">
            {formatLessonClock(timer.elapsedSeconds)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={timer.toggle} aria-keyshortcuts="Alt+P">
            {timer.running ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
            {timer.running ? "일시정지" : timer.started ? "이어서" : "믹스 시작"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={timer.reset} disabled={!timer.started && timer.nextTrack === 1}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            초기화
          </Button>
          <Button type="button" size="sm" onClick={stamp} aria-keyshortcuts="Alt+T">
            시점 찍기
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={nextTrack} aria-keyshortcuts="Alt+N">
            <Flag className="size-3.5" aria-hidden="true" />
            트랙 {timer.nextTrack}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {TARGET_LABEL[target]}에 넣습니다 · 단축키 ⌥T 시점, ⌥N 다음 트랙, ⌥P 시작/정지
        </p>
        {notice ? <p role="status" className="text-xs text-destructive">{notice}</p> : null}
      </section>

      <section aria-label="수업 메모" className="flex flex-col gap-3">
        <div role="tablist" aria-label="메모 종류" className="grid grid-cols-2 rounded-md bg-muted p-0.5 text-ui">
          {([
            ["note", "이 수업"],
            ["student", `${studentName} 전체`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${headingId}-${value}-tab`}
              aria-controls={`${headingId}-${value}`}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className="min-h-8 truncate rounded-sm px-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
            >
              {label}
            </button>
          ))}
        </div>
        {/* 두 메모를 모두 열어 두어 탭을 바꿔도 입력·초안이 끊기지 않는다. */}
        <div role="tabpanel" id={`${headingId}-note`} aria-labelledby={`${headingId}-note-tab`} hidden={tab !== "note"}>
          {noteId ? (
            <InstructorMemoEditor
              scope={{ kind: "note", noteId }}
              initial={noteMemo ?? EMPTY_MEMO}
              actorId={actorId}
              label="이 수업 메모"
              placeholder="이 수업에서만 볼 메모(학생에게 보이지 않음)"
            />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">
              노트에 제목과 본문을 적으면 노트가 만들어지고, 그때부터 이 수업 메모를 쓸 수 있습니다.
            </p>
          )}
        </div>
        <div role="tabpanel" id={`${headingId}-student`} aria-labelledby={`${headingId}-student-tab`} hidden={tab !== "student"}>
          <InstructorMemoEditor
            scope={{ kind: "student", studentId }}
            initial={studentMemo}
            actorId={actorId}
            label={`${studentName} 학생 메모`}
            placeholder="성향, 장기 과제, 주의할 점처럼 계속 볼 메모"
          />
        </div>
      </section>
    </aside>
  );
}
