"use client";

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowLeftRight, ChevronRight, Lock, Pause, Play, RotateCcw, X } from "lucide-react";
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
import {
  focusLessonTrack,
  insertLessonTag,
  insertNextTrack,
  insertSongFeedback,
  insertTransitionNote,
  nextTrackNumber,
  padTrack,
} from "./lesson-structure";
import { formatLessonClock, lessonTimestampText } from "./lesson-timestamps";
import { lessonTimerScope, useLessonTimer } from "./useLessonTimer";
import { useLessonNoteEditor, useLessonNoteStructure } from "./useLessonNoteStructure";

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
  /** 좁은 화면 아래 막대에서 전체 수업 도구(세트·타이머·메모)를 연다. */
  onOpen: () => void;
};

/** 빠른 태그. 노트 본문(학생에게도 보임)에 굵은 접두 라벨로 들어간다. */
export const LESSON_TAGS = ["비트매칭", "루프", "EQ·커브", "잔음", "볼륨", "프레이즈", "선곡·키"] as const;

/** Alt(Option)와 함께 누르는 키. 입력 중에도 쓰도록 편집기보다 먼저 받는다. */
const SHORTCUTS = { next: "KeyN", song: "KeyF", transition: "KeyM", toggle: "KeyP", stamp: "KeyT" } as const;

const EMPTY_MEMO: InstructorMemoSnapshot = { memoId: null, contentHtml: "", version: 0, updatedAt: null };

/** 편집기 초점(커서 줄)을 지키며 누르게 한다. 키보드로 누르면 초점은 버튼에 있고 동작은 커서와 관계없이 맞는다. */
const keepEditorFocus = (event: ReactMouseEvent) => event.preventDefault();

const TARGET_LABEL: Record<LessonInsertTarget, string> = { note: "노트", memo: "메모" };

/**
 * 관리자 수업 도구(노트 옆 패널, AdminNoteLesson 보드). 라이브 큐: 지금 트랙·다음 곡으로(전환 칸 + 다음 트랙 제목),
 * 곡 피드백·전환 메모, 빠른 태그, 본문에서 센 세트 목록. 타이머와 비공개 메모(이 수업·학생 전체)는 접어 둔다.
 * 좁은 화면은 아래 고정 막대(MobileAdminNoteLesson 보드)로 같은 동작을 누른다. 이 패널의 메모는 학생에게 보내지 않는다.
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
  onOpen,
}: InstructorLessonPanelProps) {
  const headingId = useId();
  const timer = useLessonTimer(lessonTimerScope(noteId, studentId));
  const editor = useLessonNoteEditor();
  const structure = useLessonNoteStructure(editor);
  const [memoTab, setMemoTab] = useState<"note" | "student">("note");
  const [timerOpen, setTimerOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [stampTarget, setStampTarget] = useState<LessonInsertTarget>("note");
  const [nextTitle, setNextTitle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const current = structure.tracks.at(-1) ?? null;
  const upcoming = nextTrackNumber(structure);

  // 시점 찍기는 마지막으로 초점을 둔 편집기(노트·메모)에 넣는다.
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const next = lessonTargetOf(event.target instanceof Element ? event.target : null);
      if (next) setStampTarget(next);
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);

  const timestamp = () => (timer.started ? lessonTimestampText(timer.readSeconds()) : null);

  const withEditor = (run: (target: NonNullable<typeof editor>) => void) => {
    if (!editor || editor.isDestroyed) {
      setNotice("노트 편집기가 아직 준비되지 않았습니다.");
      return;
    }
    setNotice(null);
    run(editor);
  };

  const nextTrack = () => withEditor((target) => {
    insertNextTrack(target, { title: nextTitle, timestamp: timestamp() });
    setNextTitle("");
  });
  const songFeedback = () => withEditor(insertSongFeedback);
  const transitionNote = () => withEditor((target) => {
    if (!insertTransitionNote(target, { timestamp: timestamp() })) setNotice("먼저 다음 곡으로 첫 트랙을 넣습니다.");
  });
  const tag = (label: string) => withEditor((target) => insertLessonTag(target, label));

  const stamp = () => {
    // 시작 전에 찍으면 그 순간을 믹스 시작으로 삼는다.
    if (!timer.running && !timer.started) timer.toggle();
    const text = lessonTimestampText(timer.started ? timer.readSeconds() : 0);
    const rootOf = (kind: LessonInsertTarget) => (kind === "memo" ? document.getElementById(`${headingId}-${memoTab}`) : null) ?? document;
    const fallback = stampTarget === "note" ? "memo" : "note";
    const target = lessonTargetEditor(rootOf(stampTarget), stampTarget) ?? lessonTargetEditor(rootOf(fallback), fallback);
    if (!target) {
      setNotice("넣을 편집기가 아직 준비되지 않았습니다.");
      return;
    }
    setNotice(null);
    insertLessonLine(target, text);
  };

  const actionsRef = useRef({ nextTrack, songFeedback, transitionNote, stamp, toggle: timer.toggle });
  useEffect(() => {
    actionsRef.current = { nextTrack, songFeedback, transitionNote, stamp, toggle: timer.toggle };
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) return;
      const actions = actionsRef.current;
      if (event.code === SHORTCUTS.next) actions.nextTrack();
      else if (event.code === SHORTCUTS.song) actions.songFeedback();
      else if (event.code === SHORTCUTS.transition) actions.transitionNote();
      else if (event.code === SHORTCUTS.stamp) actions.stamp();
      else if (event.code === SHORTCUTS.toggle) actions.toggle();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, []);

  const clock = timer.started ? (
    <span role="timer" aria-label="믹스 시간" className="inline-flex items-center gap-1.5 font-mono tabular-nums">
      {timer.running ? <span aria-hidden="true" className="size-1.5 rounded-full bg-highlight" /> : null}
      {formatLessonClock(timer.elapsedSeconds)}
    </span>
  ) : null;

  const tagButtons = (className: string) => LESSON_TAGS.map((label) => (
    <button
      key={label}
      type="button"
      onMouseDown={keepEditorFocus}
      onClick={() => tag(label)}
      className={cn(
        "shrink-0 rounded-full border border-border bg-background px-3 text-ui text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {label}
    </button>
  ));

  return (
    <>
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

        <section aria-label="지금 트랙" className="flex flex-col gap-3 rounded-[10px] border border-border p-3.5">
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">지금</span>
              <span className="truncate text-[22px] font-semibold leading-[30px] tracking-[-0.01em] text-foreground">
                {current ? `트랙 ${padTrack(current.number)}` : "시작 전"}
                {current?.title ? <span className="font-normal text-muted-foreground"> · {current.title}</span> : null}
              </span>
            </div>
            {clock ? <span className="text-[15px] leading-[22px] text-foreground">{clock}</span> : null}
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            다음 곡 제목 (선택)
            <input
              type="text"
              value={nextTitle}
              onChange={(event) => setNextTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                nextTrack();
              }}
              placeholder="비워도 됩니다"
              className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <Button type="button" className="h-11 text-sm" onMouseDown={keepEditorFocus} onClick={nextTrack} aria-keyshortcuts="Alt+N">
            <ArrowLeftRight className="size-4" strokeWidth={1.8} aria-hidden="true" />
            {current ? "다음 곡으로" : "첫 곡 시작"} · 트랙 {padTrack(upcoming)}
            <kbd className="ml-1 font-mono text-xs text-primary-foreground/60">⌥N</kbd>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-9" onMouseDown={keepEditorFocus} onClick={songFeedback} aria-keyshortcuts="Alt+F">
              곡 피드백 <kbd className="font-mono text-[11px] text-muted-foreground">⌥F</kbd>
            </Button>
            <Button type="button" variant="outline" className="h-9" onMouseDown={keepEditorFocus} onClick={transitionNote} aria-keyshortcuts="Alt+M">
              전환 메모 <kbd className="font-mono text-[11px] text-muted-foreground">⌥M</kbd>
            </Button>
          </div>
          <p className="text-xs leading-[18px] text-muted-foreground">
            다음 곡으로: 전환 칸과 다음 트랙 제목을 함께 넣고 전환 칸에 커서를 둡니다. 곡 피드백·전환 메모는 지금 트랙 구간 끝에 줄을 엽니다.
          </p>
          {notice ? <p role="status" className="text-xs text-destructive">{notice}</p> : null}
        </section>

        <section aria-labelledby={`${headingId}-tags`} className="flex flex-col gap-2">
          <h3 id={`${headingId}-tags`} className="text-xs font-medium text-muted-foreground">빠른 태그 · 지금 쓰는 줄 앞에 붙습니다</h3>
          <div className="flex flex-wrap gap-1.5">{tagButtons("h-[30px]")}</div>
        </section>

        <section aria-labelledby={`${headingId}-set`} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h3 id={`${headingId}-set`} className="text-xs font-medium text-muted-foreground">세트 · {structure.tracks.length}곡</h3>
            <span className="inline-flex items-center gap-2.5 text-[11px] text-muted-foreground" aria-hidden="true">
              <span>● 곡</span>
              <span>⇄ 전환</span>
            </span>
          </div>
          {structure.tracks.length ? (
            <ol className="flex flex-col">
              {structure.tracks.map((track, index) => {
                const isCurrent = index === structure.tracks.length - 1;
                const empty = track.songCount === 0 && !track.transition?.hasNotes;
                const label = [
                  `트랙 ${padTrack(track.number)}`,
                  track.title,
                  track.songCount ? `곡 피드백 ${track.songCount}` : null,
                  track.transition?.hasNotes ? "전환 피드백 있음" : null,
                ].filter(Boolean).join(", ");
                return (
                  <li key={`${track.number}-${track.from}`}>
                    <button
                      type="button"
                      aria-label={label}
                      aria-current={isCurrent ? "step" : undefined}
                      onClick={() => editor && focusLessonTrack(editor, track.number)}
                      className={cn(
                        "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-ui hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isCurrent ? "bg-muted font-medium text-foreground" : empty ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      <span className="w-[22px] font-mono text-xs text-muted-foreground">{padTrack(track.number)}</span>
                      <span className="min-w-0 flex-1 truncate">{track.title || `트랙 ${padTrack(track.number)}`}</span>
                      <span aria-hidden="true" className="w-7 text-right text-[10px] tracking-[1px] text-foreground">
                        {"●".repeat(Math.min(track.songCount, 3))}
                      </span>
                      <span aria-hidden="true" className="w-4 text-right text-foreground">{track.transition?.hasNotes ? "⇄" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">
              첫 곡 시작을 누르면 본문에 트랙 제목이 들어가고 여기 세트 목록이 만들어집니다.
            </p>
          )}
        </section>

        <section aria-label="보조 도구" className="flex flex-col border-t border-muted">
          <button
            type="button"
            aria-expanded={timerOpen}
            aria-controls={`${headingId}-timer`}
            onClick={() => setTimerOpen((value) => !value)}
            className="flex h-11 items-center gap-2 border-b border-muted px-0.5 text-left text-ui text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", timerOpen && "rotate-90")} strokeWidth={1.8} aria-hidden="true" />
            믹스 타이머
            <span className="flex-1" />
            <span className="font-mono text-xs text-muted-foreground">
              {timer.running ? "진행 중" : timer.started ? "일시정지" : "꺼짐"} · ⌥P
            </span>
          </button>
          <div id={`${headingId}-timer`} hidden={!timerOpen} className="py-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">믹스 시간</span>
                <span className="font-mono text-2xl tabular-nums text-foreground">{formatLessonClock(timer.elapsedSeconds)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={timer.toggle} aria-keyshortcuts="Alt+P">
                  {timer.running ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                  {timer.running ? "일시정지" : timer.started ? "이어서" : "믹스 시작"}
                </Button>
                <Button type="button" variant="secondary" size="sm" onMouseDown={keepEditorFocus} onClick={stamp} aria-keyshortcuts="Alt+T">
                  시점 찍기
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={timer.reset} disabled={!timer.started}>
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  초기화
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                타이머가 돌면 다음 곡·전환 칸에 시점이 붙습니다 · 시점 찍기는 {TARGET_LABEL[stampTarget]}에 넣습니다(⌥T)
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-expanded={memoOpen}
            aria-controls={`${headingId}-memos`}
            onClick={() => setMemoOpen((value) => !value)}
            className="flex h-11 items-center gap-2 border-b border-muted px-0.5 text-left text-ui text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", memoOpen && "rotate-90")} strokeWidth={1.8} aria-hidden="true" />
            비공개 메모
            <span className="flex-1" />
            <span className="truncate text-xs text-muted-foreground">이 수업 · {studentName} 전체</span>
          </button>
          {/* 접어도 두 메모 편집기를 열어 두어 입력·초안이 끊기지 않는다. */}
          <div id={`${headingId}-memos`} hidden={!memoOpen} className="flex flex-col gap-3 py-3">
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
                  aria-selected={memoTab === value}
                  onClick={() => setMemoTab(value)}
                  className="min-h-8 truncate rounded-sm px-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${headingId}-note`} aria-labelledby={`${headingId}-note-tab`} hidden={memoTab !== "note"}>
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
            <div role="tabpanel" id={`${headingId}-student`} aria-labelledby={`${headingId}-student-tab`} hidden={memoTab !== "student"}>
              <InstructorMemoEditor
                scope={{ kind: "student", studentId }}
                initial={studentMemo}
                actorId={actorId}
                label={`${studentName} 학생 메모`}
                placeholder="성향, 장기 과제, 주의할 점처럼 계속 볼 메모"
              />
            </div>
          </div>
        </section>
      </aside>

      {/* 좁은 화면: 서랍을 열지 않고 다음 곡·곡/전환·태그를 누르는 아래 고정 막대(MobileAdminNoteLesson 보드). */}
      <section
        aria-label="수업 도구 · 지금 트랙"
        className={cn(
          "lesson-live-bar fixed inset-x-0 bottom-0 z-30 flex-col gap-2.5 border-t border-border bg-background px-3 pt-2.5 shadow-[0_-8px_24px_rgba(24,24,27,0.06)]",
          "pb-[max(1rem,env(safe-area-inset-bottom))] xl:hidden",
          open ? "hidden" : "flex",
        )}
      >
        <div className="scroll-row flex gap-1.5">{tagButtons("h-8")}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            aria-label="수업 도구 전체 열기"
            className="flex min-h-11 min-w-16 flex-col items-start justify-center rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-[15px] font-semibold leading-5 text-foreground">{current ? `트랙 ${padTrack(current.number)}` : "시작 전"}</span>
            {clock ? <span className="text-xs leading-4 text-muted-foreground">{clock}</span> : null}
          </button>
          <Button type="button" variant="outline" className="h-11 px-3" onMouseDown={keepEditorFocus} onClick={songFeedback}>곡</Button>
          <Button type="button" variant="outline" className="h-11 px-3" onMouseDown={keepEditorFocus} onClick={transitionNote}>전환</Button>
          <Button type="button" className="h-11 flex-1 text-sm" onMouseDown={keepEditorFocus} onClick={nextTrack}>
            <ArrowLeftRight className="size-4" strokeWidth={1.8} aria-hidden="true" />
            {current ? "다음 곡" : "첫 곡 시작"}
          </Button>
        </div>
        {notice ? <p role="status" className="text-xs text-destructive">{notice}</p> : null}
      </section>
    </>
  );
}
