"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PencilLine } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { Button } from "@/components/ui/button";
import { getPrivateNote } from "@/lib/actions/privateNotes";

type NoteBodyState =
  | { status: "loading" }
  | { status: "ready"; contentHtml: string }
  | { status: "missing" }
  | { status: "error" };

/**
 * 통합 일정 payload에는 평문 미리보기만 싣고, 패널을 연 노트의 본문만 권한을 다시 확인해 불러온다.
 */
export function UnifiedNoteDetail({
  noteId,
  preview,
  returnTo,
}: {
  noteId: string;
  preview: string | null;
  returnTo: string;
}) {
  const [body, setBody] = useState<NoteBodyState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setBody({ status: "loading" });
    getPrivateNote(noteId)
      .then((note) => {
        if (!active) return;
        setBody(note ? { status: "ready", contentHtml: note.contentHtml } : { status: "missing" });
      })
      .catch(() => {
        if (active) setBody({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [noteId, attempt]);

  return (
    <div className="space-y-5">
      {body.status === "ready" ? (
        <RichTextContent html={body.contentHtml} />
      ) : body.status === "missing" ? (
        <p className="text-sm text-muted-foreground" role="status">
          휴지통으로 옮겼거나 더 이상 볼 수 없는 노트입니다.
        </p>
      ) : (
        <div className="space-y-3" aria-busy={body.status === "loading"}>
          {preview ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{preview}</p>
          ) : null}
          {body.status === "loading" ? (
            <p className="text-xs text-muted-foreground" role="status">전체 내용을 불러오는 중입니다.</p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              <span>전체 내용을 불러오지 못했습니다.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                다시 시도
              </Button>
            </div>
          )}
        </div>
      )}
      {body.status !== "missing" ? (
        <Link
          href={`/dashboard/notes/${encodeURIComponent(noteId)}?returnTo=${encodeURIComponent(returnTo)}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
          전체 화면에서 이어쓰기
        </Link>
      ) : null}
    </div>
  );
}
