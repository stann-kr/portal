/**
 * @file src/components/app-shell/CollabNotifyRefresh.tsx
 * @description 알림 room(`notify:<topic>:<id>`)에 읽기로 붙어, 대상이 바뀌었다는 알림이 오면 화면을 바로 다시 받는다.
 * Q&A 답글·상태, 학생 홈 최근 노트가 다른 창에서 바뀌면 새로고침 없이 수 초 안에 보이게 한다.
 * - 다시 연결됐을 때 room 순번(seq)이 마지막으로 본 값과 다르면 그사이 놓친 알림이 있으므로 한 번 다시 받는다.
 * - 입력 중이면(`shouldSkipRouteRefresh`) 미뤘다가 입력이 멈추면 받는다(알림을 버리지 않는다).
 * - binding이 없는 환경(next dev)은 연결하지 않고, 기존 `RouteAutoRefresh` 30초 재조회가 그대로 따라온다.
 */
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import { CollabProvider } from "@/lib/collab/client/provider";
import { formatCollabDocKey, type CollabNotifyTopic } from "@/lib/collab/doc-key";
import { shouldSkipRouteRefresh } from "./RouteAutoRefresh";

/** 알림이 몰려도 이 간격보다 자주 다시 받지 않는다. */
export const COLLAB_NOTIFY_MIN_GAP_MS = 1_500;
/** 입력 중이라 미룬 새로 받기를 다시 확인하는 간격. */
export const COLLAB_NOTIFY_DEFER_MS = 1_500;

/**
 * `since`: 화면을 서버가 그린 시각(ms). 처음 연결했을 때 room의 마지막 알림이 그보다 늦으면(그리는 사이의 변경) 한 번 다시 받는다.
 */
export function CollabNotifyRefresh({ topic, id, since }: { topic: CollabNotifyTopic; id: string; since: number }) {
  const router = useRouter();
  const routerRef = useRef(router);
  const sinceRef = useRef(since);
  useEffect(() => {
    routerRef.current = router;
    sinceRef.current = since;
  });

  useEffect(() => {
    let key: string;
    try {
      key = formatCollabDocKey({ kind: "notify", topic, id });
    } catch {
      return;
    }
    const doc = new Y.Doc();
    const provider = new CollabProvider(doc, { request: { key }, localEpoch: null });
    let lastSeq: number | null = null;
    let lastRefreshAt = 0;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      timer = null;
      if (!pending) return;
      const wait = COLLAB_NOTIFY_MIN_GAP_MS - (Date.now() - lastRefreshAt);
      if (wait > 0) {
        timer = setTimeout(run, wait);
        return;
      }
      if (document.visibilityState === "hidden" || shouldSkipRouteRefresh(document)) {
        timer = setTimeout(run, COLLAB_NOTIFY_DEFER_MS);
        return;
      }
      pending = false;
      lastRefreshAt = Date.now();
      routerRef.current.refresh();
    };
    const request = () => {
      pending = true;
      if (!timer) timer = setTimeout(run, 0);
    };
    const unsubscribe = provider.on("seq", (seq, reason, changedAt) => {
      const previous = lastSeq;
      lastSeq = seq;
      // 첫 연결: 화면을 그린 뒤에 온 알림이 있으면 따라잡는다. 그 뒤로는 순번이 바뀌면(놓친 알림 포함) 다시 받는다.
      if (previous === null && reason === "hello") {
        if (typeof changedAt === "number" && changedAt > sinceRef.current) request();
        return;
      }
      if (previous !== seq) request();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending && !timer) timer = setTimeout(run, 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      provider.destroy();
      doc.destroy();
    };
  }, [id, topic]);

  return null;
}
