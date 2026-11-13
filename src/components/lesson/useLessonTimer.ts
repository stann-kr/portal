"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 수업 중 믹스 시간을 재는 스톱워치. 새로고침해도 이어지도록 이 기기 저장소에 노트별로 남긴다.
 * 시각은 시작 시각과 쌓인 시간으로 계산하므로 탭이 가려져 timer가 늦게 돌아도 틀어지지 않는다.
 */
export type LessonTimerState = {
  /** 재생 중이면 마지막으로 시작한 시각(ms) */
  runningSince: number | null;
  /** 일시정지까지 쌓인 시간(ms) */
  elapsedMs: number;
};

/** 트랙 번호는 본문의 트랙 제목에서 센다(lesson-structure). 예전에 남긴 `nextTrack` 값은 읽지 않는다. */
const INITIAL: LessonTimerState = { runningSince: null, elapsedMs: 0 };

/** 아직 만들지 않은 새 노트의 타이머 범위. 노트가 만들어지면 그 노트 id로 옮긴다. */
const NEW_NOTE_SCOPE_PREFIX = "new:";

export function lessonTimerScope(noteId: string | null, studentId: string): string {
  return noteId ?? `${NEW_NOTE_SCOPE_PREFIX}${studentId}`;
}

function storageKey(scopeId: string): string {
  return `portal:lesson-timer:${scopeId}`;
}

function readStored(scopeId: string): LessonTimerState {
  try {
    const raw = window.localStorage.getItem(storageKey(scopeId));
    if (!raw) return INITIAL;
    const value = JSON.parse(raw) as Partial<LessonTimerState>;
    const runningSince = typeof value.runningSince === "number" && Number.isFinite(value.runningSince) ? value.runningSince : null;
    const elapsedMs = typeof value.elapsedMs === "number" && value.elapsedMs >= 0 ? value.elapsedMs : 0;
    return { runningSince, elapsedMs };
  } catch {
    return INITIAL;
  }
}

function writeStored(scopeId: string, state: LessonTimerState): void {
  try {
    if (state.runningSince === null && state.elapsedMs === 0) {
      window.localStorage.removeItem(storageKey(scopeId));
    } else {
      window.localStorage.setItem(storageKey(scopeId), JSON.stringify(state));
    }
  } catch {
    // 저장소를 쓸 수 없으면 이 화면 안에서만 잰다.
  }
}

export function lessonElapsedMs(state: LessonTimerState, now: number): number {
  return state.elapsedMs + (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince));
}

function moveStored(from: string, to: string): void {
  try {
    const raw = window.localStorage.getItem(storageKey(from));
    window.localStorage.removeItem(storageKey(from));
    if (raw && !window.localStorage.getItem(storageKey(to))) window.localStorage.setItem(storageKey(to), raw);
  } catch {
    // 저장소를 쓸 수 없으면 옮길 것도 없다.
  }
}

function removeStored(scopeId: string): void {
  try {
    window.localStorage.removeItem(storageKey(scopeId));
  } catch {
    // 저장소를 쓸 수 없으면 지울 것도 없다.
  }
}

/**
 * 새 노트 작성 화면을 이 탭에서 연 적이 있는지. 작성본(NoteEditorForm의 생성 id)처럼 탭 sessionStorage에 두어
 * 같은 탭의 새로고침은 시간을 이어받고, 다른 탭·창에서 연 새 작성 화면은 0부터 시작한다.
 */
function tabMarkerKey(scopeId: string): string {
  return `portal:lesson-timer-tab:${scopeId}`;
}

function claimNewNoteTab(scopeId: string): boolean {
  try {
    if (window.sessionStorage.getItem(tabMarkerKey(scopeId))) return true;
    window.sessionStorage.setItem(tabMarkerKey(scopeId), "1");
    return false;
  } catch {
    return false;
  }
}

function releaseNewNoteTab(scopeId: string): void {
  try {
    window.sessionStorage.removeItem(tabMarkerKey(scopeId));
  } catch {
    // 저장소를 쓸 수 없으면 표시도 없다.
  }
}

export function useLessonTimer(scopeId: string) {
  const [state, setState] = useState<LessonTimerState>(INITIAL);
  const [now, setNow] = useState(() => Date.now());
  const previousScopeRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousScopeRef.current;
    previousScopeRef.current = scopeId;
    if (previous !== null && previous !== scopeId && previous.startsWith(NEW_NOTE_SCOPE_PREFIX)) {
      // 새 노트가 만들어지면 작성 중에 잰 시간을 그 노트로 넘긴다.
      moveStored(previous, scopeId);
      releaseNewNoteTab(previous);
    } else if (previous === null && scopeId.startsWith(NEW_NOTE_SCOPE_PREFIX) && !claimNewNoteTab(scopeId)) {
      // 다른 탭에서 쓰다 만 작성 화면의 시간은 이어받지 않는다. 같은 탭 새로고침은 이어서 잰다.
      removeStored(scopeId);
    }
    // 저장소는 hydration 뒤에만 읽는다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 이 기기에 남긴 타이머는 mount 뒤에만 읽을 수 있다.
    setState(readStored(scopeId));
  }, [scopeId]);

  useEffect(() => {
    if (state.runningSince === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.runningSince]);

  const update = useCallback((next: (previous: LessonTimerState, at: number) => LessonTimerState) => {
    setState((previous) => {
      const at = Date.now();
      const value = next(previous, at);
      writeStored(scopeId, value);
      setNow(at);
      return value;
    });
  }, [scopeId]);

  const toggle = useCallback(() => update((previous, at) => (
    previous.runningSince === null
      ? { ...previous, runningSince: at }
      : { ...previous, runningSince: null, elapsedMs: lessonElapsedMs(previous, at) }
  )), [update]);

  const reset = useCallback(() => update(() => INITIAL), [update]);

  /** 지금 시각 기준 경과(초). 화면 갱신 주기와 관계없이 누른 순간을 읽는다. */
  const readSeconds = useCallback(() => Math.floor(lessonElapsedMs(state, Date.now()) / 1000), [state]);

  return {
    running: state.runningSince !== null,
    started: state.runningSince !== null || state.elapsedMs > 0,
    elapsedSeconds: Math.floor(lessonElapsedMs(state, now) / 1000),
    toggle,
    reset,
    readSeconds,
  };
}
