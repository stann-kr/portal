"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 과제 믹스를 들으며 찍어 둔 재생 시점(초). 내용은 나중에 몰아 쓰도록 이 기기에 과제별로 남긴다.
 * 피드백 초안(useFormDraft)과 따로 두어 한 건 제출·초안 복구 규칙을 바꾸지 않는다.
 */
function storageKey(actorId: string, assignmentId: string): string {
  return `portal:feedback-marks:${encodeURIComponent(actorId)}:${encodeURIComponent(assignmentId)}`;
}

function readMarks(key: string): number[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is number => Number.isInteger(item) && item >= 0).sort((a, b) => a - b)
      : [];
  } catch {
    return [];
  }
}

function writeMarks(key: string, marks: number[]): void {
  try {
    if (marks.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(marks));
  } catch {
    // 저장소를 쓸 수 없으면 이 화면 안에서만 기억한다.
  }
}

export function useFeedbackMarks(actorId: string, assignmentId: string) {
  const key = storageKey(actorId, assignmentId);
  const [marks, setMarks] = useState<number[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 이 기기에 남긴 시점은 mount 뒤에만 읽을 수 있다.
    setMarks(readMarks(key));
  }, [key]);

  const update = useCallback((next: (previous: number[]) => number[]) => {
    setMarks((previous) => {
      const value = next(previous);
      writeMarks(key, value);
      return value;
    });
  }, [key]);

  const add = useCallback((seconds: number) => update((previous) => (
    previous.includes(seconds) ? previous : [...previous, seconds].sort((a, b) => a - b)
  )), [update]);
  const remove = useCallback((seconds: number) => update((previous) => previous.filter((item) => item !== seconds)), [update]);

  return { marks, add, remove };
}
