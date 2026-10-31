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

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export const ROUTE_AUTO_REFRESH_INTERVAL_MS = 30_000;
/** focus와 visibilitychange가 함께 와도 한 번만 다시 받는다. */
const ROUTE_AUTO_REFRESH_MIN_GAP_MS = 2_000;
/** popstate 뒤 이 시간 안에 mount되면 history 복귀로 보고 한 번 다시 받는다. */
export const ROUTE_AUTO_REFRESH_HISTORY_RETURN_WINDOW_MS = 5_000;

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/**
 * 마지막 popstate 시각(ms). app router가 popstate를 받아 이전 트리를 되살리면 그 commit 뒤에 이 컴포넌트가 mount되므로
 * 리스너는 모듈 수준에서 한 번만 두고, mount 때 최근 값을 읽는다. 다시 받고 나면 0으로 돌려 StrictMode의 두 번째 effect나
 * 같은 화면의 두 번째 인스턴스가 또 받지 않게 한다.
 */
let lastHistoryReturnAt = 0;
/** 리스너를 설치한 window. 테스트가 Window를 바꿔 끼우면 새 window에 다시 설치하고 이전 시각은 버린다. */
let historyListenerWindow: Window | null = null;

function installHistoryReturnListener() {
  if (typeof window === "undefined" || historyListenerWindow === window) return;
  historyListenerWindow = window;
  lastHistoryReturnAt = 0;
  window.addEventListener("popstate", () => {
    lastHistoryReturnAt = Date.now();
  });
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

  useEffect(() => {
    installHistoryReturnListener();
    let lastRefreshedAt = 0;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (navigator.onLine === false) return;
      if (shouldSkipRouteRefresh(document)) return;
      const now = Date.now();
      if (now - lastRefreshedAt < minGapMs) return;
      lastRefreshedAt = now;
      routerRef.current.refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    // bfcache 복원은 컴포넌트를 다시 mount하지 않으므로 pageshow에서 직접 받는다.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    const interval = setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // history 복귀(뒤로/앞으로) 직후의 mount면 되살린 옛 payload 대신 한 번 다시 받는다.
    if (lastHistoryReturnAt > 0 && Date.now() - lastHistoryReturnAt < ROUTE_AUTO_REFRESH_HISTORY_RETURN_WINDOW_MS) {
      lastHistoryReturnAt = 0;
      refresh();
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, minGapMs]);

  return null;
}
