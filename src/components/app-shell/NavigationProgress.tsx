"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isProgressNavigationClick } from "./navigation-progress";

const START_EVENT = "portal:navigation-start";
/** 이보다 빨리 끝나는 이동에는 막대를 그리지 않는다(깜박임 방지). */
const SHOW_DELAY_MS = 120;
/** 주소가 끝내 바뀌지 않는 이동(중간에 취소된 클릭 등)도 막대가 남지 않게 한다. */
const GIVE_UP_MS = 15_000;

/** 버튼·action 뒤 `router.push`처럼 링크 클릭이 아닌 이동도 막대를 띄운다. */
export function startNavigationProgress() {
  window.dispatchEvent(new Event(START_EVENT));
}

/** 같은 주소로 가는 이동은 주소가 바뀌지 않아 막대가 끝나지 않으므로 켜지 않는다. */
function changesLocation(href: string): boolean {
  const target = new URL(href, window.location.href);
  return target.pathname !== window.location.pathname || target.search !== window.location.search;
}

/** `router.push`·`replace` 전에 위쪽 막대를 켜는 router. 새로고침(`refresh`)은 주소가 그대로라 막대를 켜지 않는다. */
export function useProgressRouter() {
  const router = useRouter();
  return useMemo(() => ({
    ...router,
    push: (...args: Parameters<typeof router.push>) => {
      if (changesLocation(args[0])) startNavigationProgress();
      router.push(...args);
    },
    replace: (...args: Parameters<typeof router.replace>) => {
      if (changesLocation(args[0])) startNavigationProgress();
      router.replace(...args);
    },
  }), [router]);
}

/** 지금 화면에 불러오는 중 스켈레톤(loading.tsx·셸 스켈레톤)이 있는지. */
function hasLoadingSkeleton(): boolean {
  return document.querySelector(".skeleton-region") !== null;
}

/**
 * 화면 이동을 기다리는 동안 위쪽 가장자리에 2px 막대를 띄운다(캔버스 States "화면 이동 중").
 * 다른 주소로 가는 링크 클릭과 `startNavigationProgress` 호출에서 시작하고, 주소가 바뀐 뒤 스켈레톤까지 사라지면 끝난다.
 * loading.tsx가 있는 화면은 클릭 직후(약 10ms) 주소가 먼저 바뀌고 스켈레톤이 보이므로, 주소만 보면 막대가 뜨기 전에 끝났다.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationKey = `${pathname}?${searchParams?.toString() ?? ""}`;
  const [startedAt, setStartedAt] = useState<{ key: string; id: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const locationKeyRef = useRef(locationKey);
  useEffect(() => {
    locationKeyRef.current = locationKey;
  }, [locationKey]);

  // 주소가 바뀌었으면 도착했다. 실제 내용이 그려질 때(스켈레톤이 사라질 때) 끝낸다.
  const arrived = startedAt !== null && startedAt.key !== locationKey;
  useEffect(() => {
    if (!arrived) return;
    const finish = () => {
      setStartedAt(null);
      setVisible(false);
    };
    if (!hasLoadingSkeleton()) {
      finish();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!hasLoadingSkeleton()) {
        observer.disconnect();
        finish();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [arrived]);

  useEffect(() => {
    let nextId = 0;
    const start = () => {
      // 이 뒤로 mount되는 스켈레톤만 짧은 기다림 뒤 나타난다(skeleton.css). 첫 진입 스켈레톤은 바로 보인다.
      document.documentElement.dataset.clientNav = "";
      setStartedAt({ key: locationKeyRef.current, id: ++nextId });
    };
    // bubble 단계의 window에서 듣는다. 제출 중 이동 막기(useBusyNavigationGuard)가 전파를 끊은 클릭은 여기 오지 않는다.
    // 화면 안에서 직접 처리하는 링크(커뮤니티 게시판 줄 등)는 preventDefault 뒤 주소를 스스로 바꾸거나 그대로 둔다.
    // Next Link도 preventDefault하므로, 그런 링크는 a[data-progress-skip]으로 막대를 켜지 않게 표시한다.
    const onClick = (event: MouseEvent) => {
      if (isProgressNavigationClick(event, window.location)) start();
    };
    // 주소로 검색하는 GET form(노트 검색·Q&A 필터)은 문서 이동이라 응답까지 이전 화면이 남는다.
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!event.defaultPrevented && form instanceof HTMLFormElement && form.method.toLowerCase() === "get") start();
    };
    window.addEventListener("click", onClick);
    window.addEventListener("submit", onSubmit);
    window.addEventListener(START_EVENT, start);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener(START_EVENT, start);
    };
  }, []);

  useEffect(() => {
    if (!startedAt) return;
    const show = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    const giveUp = window.setTimeout(() => {
      setStartedAt(null);
      setVisible(false);
    }, GIVE_UP_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(giveUp);
    };
  }, [startedAt]);

  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" className="portal-nav-progress">
      <span className="sr-only">화면을 불러오고 있습니다.</span>
    </div>
  );
}
