/**
 * @file src/components/app-shell/RouteAutoRefresh.tsx
 * @description 서버 컴포넌트가 한 번만 받는 목록 화면(학생·관리자 노트 목록, 학생 홈)을 조용히 다시 받는다.
 * Stann이 학생 스페이스에 새 노트를 만들면 학생 화면에 새로고침 없이 나타나게 탭이 보일 때 30초마다,
 * 그리고 창으로 돌아올 때(focus·visibilitychange) `router.refresh()`를 부른다. 입력 중이면 건너뛴다
 * (학생 홈 캘린더 패널에서 본인 노트를 편집 중일 수 있다). 진행 막대는 켜지 않는다(주소가 그대로라 끝나지 않는다).
 *
 * 자동 저장은 `revalidatePath`를 부르지 않고 app router는 뒤로/앞으로에서 이전 RSC payload를 그대로 되살리므로
 * "목록 → 노트 편집·자동 저장 → 뒤로"에서 옛 제목·날짜가 남는다. 그래서 popstate 직후 mount되면(history 복귀)
 * 한 번 더 받고, bfcache 복원(`pageshow` persisted)도 같은 규칙으로 다시 받는다. 일반 진입에서는 mount 때 받지 않는다
 * (서버가 방금 렌더했다).
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export const ROUTE_AUTO_REFRESH_INTERVAL_MS = 30_000;
/** focus와 visibilitychange가 함께 와도 한 번만 다시 받는다. */
const ROUTE_AUTO_REFRESH_MIN_GAP_MS = 2_000;
/** popstate 뒤 이 시간 안에 mount되면 history 복귀로 보고 한 번 다시 받는다. */
export const ROUTE_AUTO_REFRESH_HISTORY_RETURN_WINDOW_MS = 5_000;

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/** popstate 직전 이 시간 안에 mount된 구독자는 그 popstate의 복귀 대상으로 본다(아래 순서 문제). */
export const ROUTE_AUTO_REFRESH_HISTORY_MOUNT_LEAD_MS = 1_000;

/**
 * history 복귀 감지. 두 순서를 모두 다룬다.
 * - popstate가 먼저 처리되고 나중에 mount되는 경우: 모듈 수준 리스너가 남긴 시각을 mount 때 읽는다.
 * - mount가 먼저인 경우: React 19는 popstate 중 시작된 transition을 동기로 렌더해(eager transition), Next app router의
 *   popstate 리스너(우리보다 먼저 등록) 안에서 되살린 트리가 commit되고 effect까지 끝난다. 그 뒤에야 우리 리스너가
 *   불리므로, 리스너는 직전에 mount된 구독자에게 바로 알린다.
 * 한 번 알리면 소비해 StrictMode의 두 번째 effect나 같은 화면의 두 번째 인스턴스가 또 받지 않게 한다.
 */
let lastHistoryReturnAt = 0;
/** 리스너를 설치한 window. 테스트가 Window를 바꿔 끼우면 새 window에 다시 설치하고 이전 상태는 버린다. */
let historyListenerWindow: Window | null = null;
type HistoryReturnSubscriber = { mountedAt: number; notify: () => void };
const historyReturnSubscribers = new Set<HistoryReturnSubscriber>();

function installHistoryReturnListener() {
  if (typeof window === "undefined" || historyListenerWindow === window) return;
  historyListenerWindow = window;
  lastHistoryReturnAt = 0;
  historyReturnSubscribers.clear();
  window.addEventListener("popstate", () => {
    const now = Date.now();
    const justMounted = [...historyReturnSubscribers].filter(
      (subscriber) => now - subscriber.mountedAt < ROUTE_AUTO_REFRESH_HISTORY_MOUNT_LEAD_MS,
    );
    if (justMounted.length === 0) {
      lastHistoryReturnAt = now;
      return;
    }
    lastHistoryReturnAt = 0;
    for (const subscriber of justMounted) {
      historyReturnSubscribers.delete(subscriber);
      subscriber.notify();
    }
  });
}

/**
 * history 복귀(뒤로/앞으로 직후 mount)와 bfcache 복원(`pageshow` persisted)에서 `onReturn`을 한 번 부른다.
 * 서버 props를 state로 옮겨 쓰는 화면(관리자 홈 캘린더)은 `router.refresh()`로 갱신되지 않으므로 직접 다시 받는다.
 */
export function useHistoryReturn(onReturn: () => void) {
  const onReturnRef = useRef(onReturn);
  useEffect(() => {
    onReturnRef.current = onReturn;
  }, [onReturn]);

  useEffect(() => {
    installHistoryReturnListener();
    // bfcache 복원은 컴포넌트를 다시 mount하지 않으므로 pageshow에서 직접 받는다.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onReturnRef.current();
    };
    window.addEventListener("pageshow", onPageShow);
    const subscriber: HistoryReturnSubscriber = { mountedAt: Date.now(), notify: () => onReturnRef.current() };
    if (lastHistoryReturnAt > 0 && Date.now() - lastHistoryReturnAt < ROUTE_AUTO_REFRESH_HISTORY_RETURN_WINDOW_MS) {
      lastHistoryReturnAt = 0;
      onReturnRef.current();
    } else {
      historyReturnSubscribers.add(subscriber);
    }
    return () => {
      historyReturnSubscribers.delete(subscriber);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
}

/** 사용자가 글을 쓰고 있거나 form이 제출 중이면 서버 데이터를 다시 받지 않는다. */
export function shouldSkipRouteRefresh(doc: Document): boolean {
  const active = doc.activeElement;
  if (active && active !== doc.body) {
    const tag = active.tagName.toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input" && !NON_TEXT_INPUT_TYPES.has((active.getAttribute("type") ?? "text").toLowerCase())) return true;
    if (active.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  }
  return doc.querySelector('form[aria-busy="true"]') !== null;
}

export function RouteAutoRefresh({
  intervalMs = ROUTE_AUTO_REFRESH_INTERVAL_MS,
  minGapMs = ROUTE_AUTO_REFRESH_MIN_GAP_MS,
}: {
  intervalMs?: number;
  minGapMs?: number;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const lastRefreshedAtRef = useRef(0);
  const refresh = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    if (navigator.onLine === false) return;
    if (shouldSkipRouteRefresh(document)) return;
    const now = Date.now();
    if (now - lastRefreshedAtRef.current < minGapMs) return;
    lastRefreshedAtRef.current = now;
    routerRef.current.refresh();
  }, [minGapMs]);
  // history 복귀(뒤로/앞으로) 직후의 mount와 bfcache 복원이면 되살린 옛 payload 대신 한 번 다시 받는다.
  useHistoryReturn(refresh);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    const interval = setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, refresh]);

  return null;
}
