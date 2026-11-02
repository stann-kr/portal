"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AnyExtension } from "@tiptap/core";
import { createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";
import type { CollabDraftKind } from "../doc-key";
import { formatCollabDocKey } from "../doc-key";
import { collabDocHtml } from "./doc-html";
import { COLLAB_FRAGMENT, COLLAB_META } from "./seed";
import { useCollabDocument, type CollabDocumentState } from "./useCollabDocument";
import { useCollabLeaveGuard } from "./useCollabLeaveGuard";

/**
 * 버튼으로 등록하는 작성본(새 게시물·새 질문·답글, 게시물 수정)의 공동 편집 room.
 * 같은 사람이 여러 기기에서 열면 같은 작성본이 이어지고 선택창이 없다. 칸(제목·첨부 등)은 room `meta`에,
 * 본문은 Y.Doc에 둔다. 등록 요청 id(operationId)도 room에 두어 어느 기기에서 눌러도 한 번만 만들어진다.
 */
export type CollabFormFields = Record<string, string>;

export type CollabFormDraftOptions<F extends CollabFormFields> = {
  /** 새 글: `{ draftKind, ownerId, scope }`, 게시물 수정: `{ postId }`. null이면 연결하지 않는다. */
  room: { draftKind: CollabDraftKind; ownerId: string; scope: string } | { postId: string } | null;
  /** 기기 보관 계정(세션 사용자). */
  ownerId: string;
  /** 칸 기본값(빈 작성본·시드). */
  fields: F;
  /** 시드할 본문(게시물 수정은 게시본). */
  seedHtml?: string;
  seedVersion?: number;
  /** 연결된 상태에서 시드할 최신 서버 내용(lifecycle 포함). 없으면 처음 값으로 시드한다. */
  loadLatest?: () => Promise<{ html: string; fields: Partial<F>; version: number; lifecycle?: number } | null>;
  extensions: () => AnyExtension[];
};

export type CollabFormDraft<F extends CollabFormFields> = {
  collab: CollabDocumentState;
  key: string | null;
  ready: boolean;
  fields: F;
  setField: <K extends keyof F & string>(name: K, value: string) => void;
  /** 200ms 늦게 따라오는 본문 HTML(버튼 활성 판단용). 제출은 `readHtml()`로 최신 값을 읽는다. */
  contentHtml: string;
  readHtml: () => string;
  operationId: string;
  /** 같은 요청 id가 다른 내용으로 이미 쓰였을 때 새 요청으로 나눈다. */
  rotateOperation: () => void;
  /** 등록 성공 뒤 모든 기기에서 작성본을 비운다. */
  clear: () => void;
  /** 등록 직전 내용 표시. `clearSubmitted`가 그 뒤 바뀐 입력을 지키는 기준이다. */
  markSubmitted: () => void;
  /** 등록 성공: 제출 뒤 다른 기기·이 기기에서 바뀐 내용이 없으면 비우고, 있으면 남긴 채 요청 id만 새로 만든다. */
  clearSubmitted: () => void;
  /** 편집기에 넘길 공동 편집 설정. */
  collaboration: { doc: NonNullable<CollabDocumentState["doc"]>; awareness: CollabDocumentState["provider"] extends infer P ? P extends { awareness: infer A } ? A | null : null : null; user: CollabDocumentState["user"] } | undefined;
};

const META_OPERATION = "operationId";

export function useCollabFormDraft<F extends CollabFormFields>(options: CollabFormDraftOptions<F>): CollabFormDraft<F> {
  const { room } = options;
  const key = room ? ("postId" in room ? formatCollabDocKey({ kind: "post", id: room.postId }) : formatCollabDocKey({ kind: "draft", ...room })) : null;
  const request = useMemo(() => (key ? { key } : null), [key]);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const collab = useCollabDocument({
    offlineWritable: true,
    request,
    storageKey: key,
    ownerId: options.ownerId,
    user: { name: "", colorIndex: 0 },
    extensions: options.extensions,
    getSeed: async (_reason, { online }) => {
      if (!key) return null;
      // 연결돼 있으면 최신 서버 내용(lifecycle 포함)으로 시드한다.
      const loadLatest = optionsRef.current.loadLatest;
      const latest = loadLatest && online ? await loadLatest().catch(() => null) : null;
      if (loadLatest && online && !latest) return null;
      if (latest) {
        return {
          key,
          version: latest.version,
          lifecycle: latest.lifecycle,
          html: latest.html,
          fields: { ...optionsRef.current.fields, ...latest.fields },
        };
      }
      return {
        key,
        version: optionsRef.current.seedVersion ?? 0,
        html: optionsRef.current.seedHtml ?? "",
        fields: optionsRef.current.fields,
      };
    },
  });
  const { doc } = collab;

  const subscribeMeta = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {};
      const meta = doc.getMap(COLLAB_META);
      meta.observe(onChange);
      return () => meta.unobserve(onChange);
    },
    [doc],
  );
  const fieldNames = Object.keys(options.fields).sort().join("\u0000");
  const metaSnapshot = useSyncExternalStore(
    subscribeMeta,
    () => {
      const defaults = optionsRef.current.fields;
      if (!doc || doc.isDestroyed) return JSON.stringify([defaults, ""]);
      const meta = doc.getMap(COLLAB_META);
      const values: Record<string, string> = {};
      for (const name of Object.keys(defaults)) {
        const value = meta.get(name);
        values[name] = typeof value === "string" ? value : defaults[name];
      }
      const operation = meta.get(META_OPERATION);
      return JSON.stringify([values, typeof operation === "string" ? operation : ""]);
    },
    () => JSON.stringify([optionsRef.current.fields, ""]),
  );
  const [fields, operationId] = useMemo(() => JSON.parse(metaSnapshot) as [F, string], [metaSnapshot]);
  void fieldNames;

  // 등록 요청 id가 없으면 하나 만든다. 여러 기기가 동시에 만들어도 room에서 하나로 수렴한다.
  useEffect(() => {
    if (!doc || !collab.ready || collab.mode !== "write") return;
    if (parseCreationOperationId(doc.getMap(COLLAB_META).get(META_OPERATION))) return;
    doc.getMap(COLLAB_META).set(META_OPERATION, createCreationOperationId());
  }, [collab.mode, collab.ready, doc, operationId]);

  const setField = useCallback(
    (name: string, value: string) => {
      if (!doc || doc.isDestroyed) return;
      const meta = doc.getMap(COLLAB_META);
      if (meta.get(name) !== value) meta.set(name, value);
    },
    [doc],
  );

  const extensionsRef = useRef(options.extensions);
  const readHtml = useCallback(() => (doc && !doc.isDestroyed ? collabDocHtml(doc, extensionsRef.current()) : ""), [doc]);
  const [contentHtml, setContentHtml] = useState("");
  useEffect(() => {
    if (!doc || !collab.ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const capture = () => {
      timer = null;
      setContentHtml(readHtml());
    };
    const handle = () => {
      if (!timer) timer = setTimeout(capture, 200);
    };
    timer = setTimeout(capture, 0);
    doc.on("update", handle);
    return () => {
      doc.off("update", handle);
      if (timer) clearTimeout(timer);
    };
  }, [collab.ready, doc, readHtml]);

  const rotateOperation = useCallback(() => {
    if (doc && !doc.isDestroyed) doc.getMap(COLLAB_META).set(META_OPERATION, createCreationOperationId());
  }, [doc]);

  const clear = useCallback(() => {
    if (!doc || doc.isDestroyed) return;
    doc.transact(() => {
      const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
      if (fragment.length > 0) fragment.delete(0, fragment.length);
      const meta = doc.getMap(COLLAB_META);
      for (const [name, value] of Object.entries(optionsRef.current.fields)) meta.set(name, value);
      meta.set(META_OPERATION, createCreationOperationId());
    });
  }, [doc]);

  const submittedRef = useRef<string | null>(null);
  const snapshotKey = useCallback(() => {
    if (!doc || doc.isDestroyed) return "";
    const meta = doc.getMap(COLLAB_META);
    const values = Object.keys(optionsRef.current.fields).map((name) => meta.get(name));
    return JSON.stringify([values, readHtml()]);
  }, [doc, readHtml]);
  const markSubmitted = useCallback(() => {
    submittedRef.current = snapshotKey();
  }, [snapshotKey]);
  const clearSubmitted = useCallback(() => {
    const submitted = submittedRef.current;
    submittedRef.current = null;
    if (submitted !== null && submitted !== snapshotKey()) {
      rotateOperation();
      return;
    }
    clear();
  }, [clear, rotateOperation, snapshotKey]);

  useCollabLeaveGuard(() => collab.hasUnsentChanges());

  const solo = collab.status === "solo";
  const collaboration = useMemo(
    () => (doc ? { doc, awareness: solo ? null : collab.provider?.awareness ?? null, user: collab.user } : undefined),
    [collab.provider, collab.user, doc, solo],
  ) as CollabFormDraft<F>["collaboration"];

  return {
    collab,
    key,
    ready: collab.ready,
    fields,
    setField,
    contentHtml,
    readHtml,
    operationId,
    rotateOperation,
    clear,
    markSubmitted,
    clearSubmitted,
    collaboration,
  };
}
