"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { createPrivateNote, type CreateNoteState } from "@/lib/actions/privateNotes";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { toKstDateInputValue } from "@/lib/date-input";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);

const initialState: CreateNoteState = {};

export function PrivateNoteForm({
  studentId,
  actorId,
}: {
  studentId: string;
  actorId: string;
}) {
  const boundAction = createPrivateNote.bind(null, studentId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  useBusyNavigationGuard(pending);
  const today = toKstDateInputValue();
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState(today);
  const [contentHtml, setContentHtml] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const submittedDraftRef = useRef<{
    title: string;
    noteDate: string;
    contentHtml: string;
  } | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);

  // 임시저장 복원/저장 (학생별 키)
  const {
    loaded,
    save,
    clear,
    status,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  } = useFormDraft<{ title: string; noteDate: string; contentHtml: string }>(
    createDocumentDraftKey("note", actorId, `new:${studentId}`),
    (d) => {
      setTitle(d.title ?? "");
      if (d.noteDate) setNoteDate(d.noteDate);
      setContentHtml(d.contentHtml ?? "");
    },
    {
      onReset: () => {
        setTitle("");
        setNoteDate(today);
        setContentHtml("");
        setEditorKey((key) => key + 1);
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    const isEmpty = !title && isRichTextEmpty(contentHtml);
    if (isEmpty) {
      clear();
      return;
    }
    save({ title, noteDate, contentHtml });
  }, [loaded, title, noteDate, contentHtml, save, clear]);

  // 저장 성공 시 draft 삭제 + 폼 초기화 (에디터 remount)
  useEffect(() => {
    if (
      state.success &&
      state.note?.id &&
      handledNoteIdRef.current !== state.note.id
    ) {
      handledNoteIdRef.current = state.note.id;
      clear({
        reason: "submitted",
        submittedData: submittedDraftRef.current ?? { title, noteDate, contentHtml },
      });
      submittedDraftRef.current = null;
      setTitle("");
      setNoteDate(today);
      setContentHtml("");
      setEditorKey((k) => k + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.note?.id]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
      onSubmit={() => {
        submittedDraftRef.current = { title, noteDate, contentHtml };
      }}
    >
      {state.error && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-success">노트가 저장되었습니다.</p>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 space-y-2">
          <label htmlFor="title" className="text-sm font-medium">제목</label>
          <Input
            id="title"
            name="title"
            type="text"
            required
            placeholder="오늘의 수업 요약"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-2 sm:w-44">
          <label htmlFor="note-date" className="text-sm font-medium">날짜</label>
          <Input
            id="note-date"
            name="noteDate"
            type="date"
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">내용</label>
        <input type="hidden" name="contentHtml" value={contentHtml} />
        {loaded && (
          <FullEditor
            key={editorKey}
            initialContent={contentHtml}
            onChange={setContentHtml}
            placeholder="수업 내용, 메모 등을 작성하세요..."
            disabled={pending}
            minHeight="300px"
            ariaLabel="노트 내용"
            footer={
              <DraftStatus
                status={status}
                savedAt={savedAt}
                restored={restored}
                recoveries={recoveries}
                onRestoreRecovery={restoreRecovery}
                onDiscardRecovery={discardRecovery}
                disabled={pending}
              />
            }
            onSave={() => formRef.current?.requestSubmit()}
          />
        )}
      </div>

      <Button type="submit" disabled={pending || !title.trim() || isRichTextEmpty(contentHtml)} className="w-full">
        {pending ? "작성 중..." : "노트 저장"}
      </Button>
    </form>
  );
}
