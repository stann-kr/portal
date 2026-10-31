/**
 * @file src/components/app-shell/RouteAutoRefresh.tsx
 * @description 서버 컴포넌트가 한 번만 받는 목록 화면(학생 노트 목록·학생 홈)을 조용히 다시 받는다.
 * Stann이 학생 스페이스에 새 노트를 만들면 학생 화면에 새로고침 없이 나타나게 탭이 보일 때 30초마다,
 * 그리고 창으로 돌아올 때(focus·visibilitychange) `router.refresh()`를 부른다. 입력 중이면 건너뛴다
 * (학생 홈 캘린더 패널에서 본인 노트를 편집 중일 수 있다). 진행 막대는 켜지 않는다(주소가 그대로라 끝나지 않는다).
 */
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export const ROUTE_AUTO_REFRESH_INTERVAL_MS = 30_000;
/** focus와 visibilitychange가 함께 와도 한 번만 다시 받는다. */
const ROUTE_AUTO_REFRESH_MIN_GAP_MS = 2_000;

const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

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
    const interval = setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, minGapMs]);

  return null;
}
