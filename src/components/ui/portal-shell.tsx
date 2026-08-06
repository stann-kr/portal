"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  PortalNavigation,
  type PortalNavigationItem,
} from "@/components/ui/portal-navigation";

export function PortalShell<T extends string>({
  items,
  initialItem,
  storageKey,
  storageAliases,
  urlParamKey,
  ariaLabel,
  endSlot,
  children,
}: {
  items: readonly PortalNavigationItem<T>[];
  initialItem: T;
  storageKey?: string;
  storageAliases?: Readonly<Record<string, T>>;
  /** section을 URL에도 기록해 새로고침·뒤로가기·공유 가능한 위치로 만든다. */
  urlParamKey?: string;
  ariaLabel: string;
  endSlot?: ReactNode;
  children: (activeItem: T, changeItem: (item: T) => void) => ReactNode;
}) {
  const [activeItem, setActiveItem] = useState<T>(initialItem);

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
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };

    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [initialItem, items, storageAliases, storageKey, urlParamKey]);

  const changeItem = useCallback(
    (item: T) => {
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
        window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    },
    [storageKey, urlParamKey],
  );

  return (
    <div className="flex h-full min-h-[100dvh] flex-col">
      <PortalNavigation
        items={items}
        activeItem={activeItem}
        onChange={changeItem}
        ariaLabel={ariaLabel}
        endSlot={endSlot}
      />
      <div className="flex-1 overflow-hidden">{children(activeItem, changeItem)}</div>
    </div>
  );
}
