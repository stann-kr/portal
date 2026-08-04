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
  ariaLabel,
  endSlot,
  children,
}: {
  items: readonly PortalNavigationItem<T>[];
  initialItem: T;
  storageKey?: string;
  storageAliases?: Readonly<Record<string, T>>;
  ariaLabel: string;
  endSlot?: ReactNode;
  children: (activeItem: T, changeItem: (item: T) => void) => ReactNode;
}) {
  const [activeItem, setActiveItem] = useState<T>(initialItem);

  useEffect(() => {
    if (!storageKey) return;

    try {
      const saved = localStorage.getItem(storageKey);
      const directMatch = items.find((item) => item.id === saved)?.id;
      const restored = directMatch ?? (saved ? storageAliases?.[saved] : undefined);
      if (restored) setActiveItem(restored);
    } catch {
      // storage를 사용할 수 없는 환경에서는 초기 section을 유지합니다.
    }
  }, [items, storageAliases, storageKey]);

  const changeItem = useCallback(
    (item: T) => {
      setActiveItem(item);
      if (!storageKey) return;

      try {
        localStorage.setItem(storageKey, item);
      } catch {
        // navigation은 storage 실패와 무관하게 동작합니다.
      }
    },
    [storageKey],
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
