"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 수업 중 믹스 시간을 재는 스톱워치. 새로고침해도 이어지도록 이 기기 저장소에 노트별로 남긴다.
 * 시각은 시작 시각과 쌓인 시간으로 계산하므로 탭이 가려져 timer가 늦게 돌아도 틀어지지 않는다.
 */
export type LessonTimerState = {
  /** 재생 중이면 마지막으로 시작한 시각(ms) */
  runningSince: number | null;
  /** 일시정지까지 쌓인 시간(ms) */
  elapsedMs: number;
  /** 다음에 넣을 트랙 번호 */
  nextTrack: number;
};

const INITIAL: LessonTimerState = { runningSince: null, elapsedMs: 0, nextTrack: 1 };

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
    const nextTrack = typeof value.nextTrack === "number" && Number.isInteger(value.nextTrack) && value.nextTrack >= 1 ? value.nextTrack : 1;
    return { runningSince, elapsedMs, nextTrack };
  } catch {
    return INITIAL;
  }
}

function writeStored(scopeId: string, state: LessonTimerState): void {
  try {
    if (state.runningSince === null && state.elapsedMs === 0 && state.nextTrack === 1) {
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

export function useLessonTimer(scopeId: string) {
  const [state, setState] = useState<LessonTimerState>(INITIAL);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
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

  /** 트랙 번호를 하나 쓰고 다음 번호로 넘긴다. */
  const takeTrack = useCallback((): number => {
    const track = state.nextTrack;
    update((previous) => ({ ...previous, nextTrack: previous.nextTrack + 1 }));
    return track;
  }, [state.nextTrack, update]);

  /** 지금 시각 기준 경과(초). 화면 갱신 주기와 관계없이 누른 순간을 읽는다. */
  const readSeconds = useCallback(() => Math.floor(lessonElapsedMs(state, Date.now()) / 1000), [state]);

  return {
    running: state.runningSince !== null,
    started: state.runningSince !== null || state.elapsedMs > 0,
    elapsedSeconds: Math.floor(lessonElapsedMs(state, now) / 1000),
    nextTrack: state.nextTrack,
    toggle,
    reset,
    takeTrack,
    readSeconds,
  };
}
