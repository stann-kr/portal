/**
 * @file src/lib/hooks/useLiveNote.ts
 * @description 읽기 전용 노트의 실시간 보기. Stann이 학생 스페이스에 쓰는 동안 학생 화면이 새로고침 없이 따라오게
 * 탭이 보이고 온라인일 때 head(version)를 가볍게 폴링하고, version이 올라갔을 때만 본문을 다시 받아 교체한다.
 * SSE·Durable Object 없이 Workers+D1 server action만 쓴다. 숨김·오프라인이면 타이머를 멈추고,
 * 다시 보이거나(focus·visibilitychange) 온라인이 되면 즉시 한 번 조회하고 backoff를 초기화한다.
 * 조회 오류도 변화 없음과 같이 backoff를 쌓는다(세션 만료·지속 오류에서 기본 간격으로 계속 두드리지 않는다).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { getPrivateNote, getPrivateNoteHead } from "@/lib/actions/privateNotes";
import {
  LIVE_NOTE_BASE_POLL_MS,
  LIVE_NOTE_MAX_POLL_MS,
  getLiveNotePollDelay,
} from "@/lib/live-note-polling";

export type LiveNoteSnapshot = {
  version: number;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  updatedAt: Date | null;
};

/** `getPrivateNote`가 돌려주는 전체 행. 본문 교체 때 화면 밖(캘린더 항목 등)에도 알릴 수 있게 그대로 넘긴다. */
export type LiveNoteRecord = NonNullable<Awaited<ReturnType<typeof getPrivateNote>>>;

export type LiveNoteState = {
  note: LiveNoteSnapshot;
  /** `missing`: head가 null(휴지통 이동·영구 삭제·권한 상실). 마지막 본문은 그대로 둔다. */
  status: "live" | "missing";
  /** 폴링으로 새 본문을 받은 마지막 시각(ms). 처음 값은 서버가 준 것이라 null. */
  refreshedAt: number | null;
};

export type UseLiveNoteOptions = {
  noteId: string;
  initial: LiveNoteSnapshot;
  enabled?: boolean;
  /** 기본 폴링 간격(ms). 테스트에서 짧게 준다. */
  pollDelay?: number;
  maxPollDelay?: number;
  /** 새 본문을 받아 교체했을 때. */
  onUpdate?: (note: LiveNoteRecord) => void;
};

function toSnapshot(note: LiveNoteRecord): LiveNoteSnapshot {
  return {
    version: note.version,
    title: note.title,
    contentHtml: note.contentHtml,
    noteDate: note.noteDate,
    updatedAt: note.updatedAt,
  };
}

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function useLiveNote({
  noteId,
  initial,
  enabled = true,
  pollDelay = LIVE_NOTE_BASE_POLL_MS,
  maxPollDelay = LIVE_NOTE_MAX_POLL_MS,
  onUpdate,
}: UseLiveNoteOptions): LiveNoteState {
  const [state, setState] = useState<LiveNoteState>({ note: initial, status: "live", refreshedAt: null });
  // 폴링 closure가 본문을 다시 받을지 정할 때 쓰는 현재 version. 최종 판정은 아래 `apply`의 함수형 setState가 한다.
  const latestVersionRef = useRef(initial.version);
  useEffect(() => {
    latestVersionRef.current = state.note.version;
  }, [state.note.version]);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // 서버가 더 새 초기값을 넘기면(router.refresh 등) 렌더 중 바로 받아들인다. 객체가 아니라 version으로 비교해 렌더 루프를 막는다.
  const [seenInitialVersion, setSeenInitialVersion] = useState(initial.version);
  if (seenInitialVersion !== initial.version) {
    setSeenInitialVersion(initial.version);
    if (initial.version > state.note.version) {
      setState({ note: initial, status: "live", refreshedAt: null });
    }
  }

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pollAgain = false;
    let unchangedPolls = 0;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      if (disposed) return;
      clearTimer();
      const delay = getLiveNotePollDelay({
        visible: isDocumentVisible(),
        online: isOnline(),
        unchangedPolls,
        baseDelay: pollDelay,
        maxDelay: maxPollDelay,
      });
      if (delay === null) return;
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, delay);
    };

    // 늦게 도착한 옛 본문이 새 본문을 덮지 않게 더 새로운 version만 받아들인다(ref로 즉시, state 갱신에서 한 번 더).
    const apply = (note: LiveNoteRecord): boolean => {
      if (note.version <= latestVersionRef.current) return false;
      latestVersionRef.current = note.version;
      const refreshedAt = Date.now();
      setState((current) => (
        note.version <= current.note.version ? current : { note: toSnapshot(note), status: "live", refreshedAt }
      ));
      onUpdateRef.current?.(note);
      return true;
    };

    const markMissing = () => {
      setState((current) => (current.status === "missing" ? current : { ...current, status: "missing" }));
    };

    const poll = async () => {
      if (disposed) return;
      if (inFlight) {
        pollAgain = true;
        return;
      }
      inFlight = true;
      try {
        const head = await getPrivateNoteHead(noteId);
        if (disposed) return;
        if (!head) {
          markMissing();
          unchangedPolls += 1;
        } else if (head.version > latestVersionRef.current) {
          const note = await getPrivateNote(noteId);
          if (disposed) return;
          if (!note) {
            markMissing();
            unchangedPolls += 1;
          } else if (apply(note)) {
            unchangedPolls = 0;
          } else {
            unchangedPolls += 1;
          }
        } else {
          // 휴지통에서 복원되면 head가 다시 생긴다.
          setState((current) => (current.status === "live" ? current : { ...current, status: "live" }));
          unchangedPolls += 1;
        }
      } catch {
        // 일시 오류는 조용히 다음 폴링으로. 세션 만료·지속 네트워크 오류에서 기본 간격으로 계속 두드리지 않게
        // 변화 없음과 같은 backoff를 쌓는다(wake가 다시 0으로 돌린다).
        unchangedPolls += 1;
      } finally {
        inFlight = false;
        if (!disposed) {
          // 진행 중에 wake가 왔어도 그 사이 숨김·오프라인이 됐으면 바로 다시 조회하지 않는다(schedule이 타이머를 두지 않는다).
          if (pollAgain && isDocumentVisible() && isOnline()) {
            pollAgain = false;
            unchangedPolls = 0;
            void poll();
          } else {
            pollAgain = false;
            schedule();
          }
        }
      }
    };

    // 보이고 온라인이면 즉시 한 번 조회하고 backoff를 초기화한다.
    const wake = () => {
      if (!isDocumentVisible() || !isOnline()) {
        clearTimer();
        return;
      }
      unchangedPolls = 0;
      clearTimer();
      void poll();
    };
    const onVisibilityChange = () => {
      if (isDocumentVisible()) wake();
      else clearTimer();
    };
    const onOffline = () => clearTimer();

    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // 초기값은 방금 서버에서 받은 것이므로 첫 조회는 한 간격 뒤에 한다.
    schedule();

    return () => {
      disposed = true;
      clearTimer();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, maxPollDelay, noteId, pollDelay]);

  return state;
}
