"use client";

import { useEffect } from "react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";

/** 알림이 열 주소로 받아도 되는 값: 같은 출처의 경로만(`/`로 시작, `//` 제외). */
export function safeNotificationPath(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

/**
 * 알림을 눌렀을 때 Service Worker(public/sw.js)가 보낸 이동 부탁을 받아 앱 안 이동으로 옮긴다.
 * 전에는 열린 화면도 문서를 새로 받아 셸까지 다시 그렸다. 답("navigated")을 못 받으면 Service Worker가 문서 이동한다.
 */
export function ServiceWorkerNavigation() {
  const router = useProgressRouter();
  useEffect(() => {
    const container = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!container) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || data.type !== "portal:navigate") return;
      const path = safeNotificationPath(data.url);
      if (!path) return;
      router.push(path);
      event.ports[0]?.postMessage("navigated");
    };
    container.addEventListener("message", onMessage);
    return () => container.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}
