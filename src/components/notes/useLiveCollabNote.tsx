"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { createFullEditorExtensions } from "@/components/editor/FullEditor";
import { formatCollabDocKey } from "@/lib/collab/doc-key";
import { collabDocHtml } from "@/lib/collab/client/doc-html";
import { COLLAB_META } from "@/lib/collab/client/seed";
import { useCollabDocument } from "@/lib/collab/client/useCollabDocument";
import { getPrivateNote } from "@/lib/actions/privateNotes";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((module) => ({ default: module.FullEditor })),
  { ssr: false },
);

/**
 * 읽기 전용 실시간 노트(학생이 Stann의 노트를 볼 때). 같은 room에 읽기 토큰으로 붙어 입력과 커서를 바로 본다.
 * room이 아직 비어 있거나(작성자가 이 기능 이후 아직 열지 않음) 볼 수 없게 되면 마지막으로 본 내용을 정적으로 보여 준다.
 */
export type LiveNoteSource = {
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  updatedAt: Date | null;
};

export type LiveCollabNote = {
  title: string;
  /** `YYYY-MM-DD` 또는 빈 값. */
  noteDate: string;
  /** 볼 수 없게 됨(휴지통·권한 변경). */
  missing: boolean;
  /** 열린 뒤 다른 사람의 입력이 들어온 마지막 시각(ms). */
  changedAt: number | null;
  body: React.ReactNode;
};

function toDateInputValue(value: Date | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function useLiveCollabNote(
  note: LiveNoteSource,
  onChanged?: (current: { title: string; contentHtml: string; noteDate: string }) => void,
): LiveCollabNote {
  const key = formatCollabDocKey({ kind: "note", id: note.id });
  const extensionsRef = useRef<ReturnType<typeof createFullEditorExtensions> | null>(null);
  const getExtensions = useCallback(() => {
    extensionsRef.current ??= createFullEditorExtensions();
    return extensionsRef.current;
  }, []);
  const request = useMemo(() => ({ key }), [key]);
  const collab = useCollabDocument({
    request,
    storageKey: key,
    user: { name: "", colorIndex: 0 },
    extensions: getExtensions,
    // 읽기 전용은 room에 시드를 넣지 않는다(쓰기 권한이 없어 서버가 거부한다).
    getSeed: () => null,
  });
  const [lastSeen, setLastSeen] = useState({
    title: note.title,
    noteDate: toDateInputValue(note.noteDate),
    contentHtml: note.contentHtml,
  });
  const [changedAt, setChangedAt] = useState<number | null>(null);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useEffect(() => {
    const doc = collab.doc;
    if (!doc || !collab.ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const capture = () => {
      timer = null;
      if (doc.isDestroyed) return;
      const meta = doc.getMap(COLLAB_META);
      const next = {
        title: typeof meta.get("title") === "string" ? (meta.get("title") as string) : "",
        noteDate: typeof meta.get("noteDate") === "string" ? (meta.get("noteDate") as string) : "",
        contentHtml: collabDocHtml(doc, getExtensions()),
      };
      setLastSeen(next);
      onChangedRef.current?.(next);
    };
    const handleUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== "seed") setChangedAt(Date.now());
      if (!timer) timer = setTimeout(capture, 300);
    };
    capture();
    doc.on("update", handleUpdate);
    return () => {
      doc.off("update", handleUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [collab.doc, collab.ready, getExtensions]);

  // room이 다시 시작되면(작성자가 복원) room이 다시 채워질 때까지 서버의 새 head를 보여 준다.
  useEffect(() => {
    if (collab.generation === 0) return;
    let cancelled = false;
    void getPrivateNote(note.id)
      .then((latest) => {
        if (cancelled || !latest) return;
        const next = { title: latest.title, noteDate: toDateInputValue(latest.noteDate), contentHtml: latest.contentHtml };
        setLastSeen(next);
        onChangedRef.current?.(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [collab.generation, note.id]);

  const missing = collab.status === "denied";
  const collaboration = useMemo(
    () => (collab.doc ? { doc: collab.doc, awareness: collab.provider?.awareness ?? null, user: collab.user } : null),
    [collab.doc, collab.provider, collab.user],
  );
  const body = collab.ready && !missing && collaboration ? (
    <FullEditor
      key={collab.generation}
      collaboration={collaboration}
      disabled
      ariaLabel="노트 내용"
      variant="page"
      minHeight="0"
    />
  ) : (
    <RichTextContent html={lastSeen.contentHtml} />
  );
  return {
    title: lastSeen.title || note.title,
    noteDate: lastSeen.noteDate,
    missing,
    changedAt,
    body,
  };
}
