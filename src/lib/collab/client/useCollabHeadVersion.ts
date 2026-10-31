"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { COLLAB_META } from "./seed";

/**
 * 저장 기준 서버 version. 저장 담당은 성공한 version을 room `meta.headVersion`에 남기고,
 * 다른 기기는 그 값을 따라가 담당이 바뀌어도 기준 version이 이어진다.
 */
export const COLLAB_META_HEAD_VERSION = "headVersion";

export type CollabHeadVersion = {
  value: number;
  current: () => number;
  /** 저장 성공: 화면 값과 room에 남긴다. */
  publish: (version: number) => void;
  /** 충돌 응답 등에서 알게 된 최신 version을 기준으로만 쓴다(room에는 남기지 않는다). */
  adopt: (version: number) => void;
};

export function useCollabHeadVersion(doc: Y.Doc | null, initial: number): CollabHeadVersion {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  useEffect(() => {
    if (!doc) return;
    const meta = doc.getMap(COLLAB_META);
    const sync = () => {
      const next = meta.get(COLLAB_META_HEAD_VERSION);
      if (typeof next === "number" && next > ref.current) {
        ref.current = next;
        setValue(next);
      }
    };
    sync();
    meta.observe(sync);
    return () => meta.unobserve(sync);
  }, [doc]);
  return useMemo(
    () => ({
      value,
      current: () => ref.current,
      publish: (version: number) => {
        ref.current = version;
        setValue(version);
        if (doc && !doc.isDestroyed) {
          doc.transact(() => doc.getMap(COLLAB_META).set(COLLAB_META_HEAD_VERSION, version), "collab-autosave-meta");
        }
      },
      adopt: (version: number) => {
        ref.current = version;
      },
    }),
    [doc, value],
  );
}
