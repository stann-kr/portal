"use client";

import { useCallback, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { COLLAB_META } from "./seed";

/** room `meta` map의 한 칸(제목·날짜 등)을 React 값으로 읽고 쓴다. 칸 단위로 마지막 입력이 남는다. */
export function useCollabMetaField(doc: Y.Doc | null, name: string, fallback: string): [string, (value: string) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {};
      const meta = doc.getMap(COLLAB_META);
      const handle = (event: Y.YMapEvent<unknown>) => {
        if (event.keysChanged.has(name)) onChange();
      };
      meta.observe(handle);
      return () => meta.unobserve(handle);
    },
    [doc, name],
  );
  const read = useCallback(() => {
    if (!doc || doc.isDestroyed) return fallback;
    const value = doc.getMap(COLLAB_META).get(name);
    return typeof value === "string" ? value : fallback;
  }, [doc, fallback, name]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const write = useCallback(
    (next: string) => {
      if (!doc || doc.isDestroyed) return;
      const meta = doc.getMap(COLLAB_META);
      if (meta.get(name) !== next) meta.set(name, next);
    },
    [doc, name],
  );
  return [value, write];
}
