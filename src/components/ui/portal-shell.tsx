"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * 포털 화면의 구역 상태. 구역 이동 메뉴는 사이드바가 맡고, 이 컴포넌트는 주소·기기 저장값에서
 * 현재 구역을 정해 그리며 구역별 스크롤 위치를 기억한다.
 */
export function PortalShell<T extends string>({
  items,
  initialItem,
  storageKey,
  storageAliases,
  urlParamKey,
  ariaLabel,
  children,
}: {
  items: readonly { id: T }[];
  initialItem: T;
  storageKey?: string;
  storageAliases?: Readonly<Record<string, T>>;
  /** section을 URL에도 기록해 새로고침·뒤로가기·공유 가능한 위치로 만든다. */
  urlParamKey?: string;
  ariaLabel: string;
  children: (activeItem: T, changeItem: (item: T) => void) => ReactNode;
}) {
  const [activeItem, setActiveItem] = useState<T>(initialItem);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<T, number>());

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = scrollPositions.current.get(activeItem) ?? 0;
  }, [activeItem]);

  useEffect(() => {
    const restore = () => {
      const urlValue = urlParamKey
        ? new URLSearchParams(window.location.search).get(urlParamKey)
        : null;
      const urlMatch = items.find((item) => item.id === urlValue)?.id;
      if (urlMatch) {
        setActiveItem(urlMatch);
        return;
      }

      let restored: T = initialItem;
      if (storageKey) {
        try {
          const saved = localStorage.getItem(storageKey);
          const directMatch = items.find((item) => item.id === saved)?.id;
          restored = directMatch ?? (saved ? storageAliases?.[saved] : undefined) ?? initialItem;
        } catch {
          // storage를 사용할 수 없는 환경에서는 초기 section을 유지합니다.
        }
      }
      setActiveItem(restored);

      // 첫 진입도 canonical URL로 만들어 이후 뒤로/앞으로 이동이 같은 section을 복원하게 한다.
      if (urlParamKey) {
        const url = new URL(window.location.href);
        url.searchParams.set(urlParamKey, restored);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };

    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [initialItem, items, storageAliases, storageKey, urlParamKey]);

  const changeItem = useCallback(
    (item: T) => {
      if (item === activeItem) return;
      setActiveItem(item);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, item);
        } catch {
          // navigation은 storage 실패와 무관하게 동작합니다.
        }
      }

      if (urlParamKey) {
        const url = new URL(window.location.href);
        url.searchParams.set(urlParamKey, item);
        window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    },
    [activeItem, storageKey, urlParamKey],
  );

  return (
    <div className="flex h-app min-h-0 flex-col">
      <div
        ref={contentRef}
        role="region"
        aria-label={`${ariaLabel} 콘텐츠`}
        tabIndex={0}
        onScroll={(event) => scrollPositions.current.set(activeItem, event.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {children(activeItem, changeItem)}
      </div>
    </div>
  );
}
