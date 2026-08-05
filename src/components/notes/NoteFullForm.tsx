/**
 * @file src/components/notes/NoteFullForm.tsx
 * @description 노트 작성 풀 페이지 클라이언트 폼.
 * 서버 컴포넌트에서 createPrivateNote.bind(null, studentId)로 바인딩된 action을 받아 사용.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateNoteState } from "@/lib/actions/privateNotes";
import { DraftStatus } from "@/components/editor/DraftStatus";
import { useFormDraft } from "@/lib/hooks/useFormDraft";
import { createDocumentDraftKey } from "@/lib/form-draft";
import { isRichTextEmpty } from "@/lib/rich-text";
import { toKstDateInputValue } from "@/lib/date-input";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);

interface NoteFullFormProps {
  /** createPrivateNote.bind(null, studentId) */
  action: (prev: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
  actorId: string;
  studentId: string;
  returnTo: string;
}

export function NoteFullForm({ action, actorId, studentId, returnTo }: NoteFullFormProps) {
  const today = toKstDateInputValue();
  const [title, setTitle] = useState("");
  const [noteDate, setNoteDate] = useState(today);
  const [contentHtml, setContentHtml] = useState("");
  const [state, formAction, isPending] = useActionState<CreateNoteState, FormData>(
    action,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submittedDraftRef = useRef<{
    title: string;
    noteDate: string;
    contentHtml: string;
  } | null>(null);
  const handledNoteIdRef = useRef<string | null>(null);
  const router = useRouter();
  useBusyNavigationGuard(isPending);

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
  } = useFormDraft<{
    title: string;
    noteDate: string;
    contentHtml: string;
  }>(
    createDocumentDraftKey("note", actorId, `new:${studentId}`),
    (draft) => {
      setTitle(draft.title ?? "");
      setNoteDate(draft.noteDate || today);
      setContentHtml(draft.contentHtml ?? "");
    },
    {
      onReset: () => {
        setTitle("");
        setNoteDate(today);
        setContentHtml("");
      },
    },
  );

  useEffect(() => {
    if (!loaded) return;
    if (!title && isRichTextEmpty(contentHtml)) {
      clear();
      return;
    }
    save({ title, noteDate, contentHtml });
  }, [clear, contentHtml, loaded, noteDate, save, title]);

  useEffect(() => {
    if (!state.note?.id || handledNoteIdRef.current === state.note.id) return;
    handledNoteIdRef.current = state.note.id;
    clear({
      reason: "submitted",
      submittedData: submittedDraftRef.current ?? { title, noteDate, contentHtml },
    });
    submittedDraftRef.current = null;
    router.replace(`/dashboard/notes/${state.note.id}?returnTo=${encodeURIComponent(returnTo)}`);
  }, [clear, contentHtml, noteDate, returnTo, router, state.note?.id, title]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-6 px-4">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={returnTo}
          aria-disabled={isPending}
          tabIndex={isPending ? -1 : undefined}
          className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground ${
            isPending ? "pointer-events-none opacity-50" : ""
          }`}
          onClick={(event) => {
            if (isPending) event.preventDefault();
          }}
        >
          <ArrowLeft className="w-4 h-4" />
          포털로 돌아가기
        </Link>
        <h1 className="text-2xl font-semibold mt-2">노트 작성</h1>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="space-y-5"
        onSubmit={() => {
          submittedDraftRef.current = { title, noteDate, contentHtml };
        }}
      >
        <input type="hidden" name="contentHtml" value={contentHtml} />

        {state?.error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {state.error}
          </div>
        )}

        {state?.success && (
          <div
            role="status"
            className="rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success"
          >
            노트가 저장되었습니다.
          </div>
        )}

        {/* 제목 + 날짜 */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="note-title" className="text-sm font-medium">
              제목 <span className="text-destructive">*</span>
            </label>
            <Input
              id="note-title"
              name="title"
              placeholder="오늘의 수업 요약"
              required
              disabled={isPending}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:w-44">
            <label htmlFor="note-date" className="text-sm font-medium">
              날짜
            </label>
            <Input
              id="note-date"
              name="noteDate"
              type="date"
              value={noteDate}
              onChange={(event) => setNoteDate(event.target.value)}
              disabled={isPending}
            />
          </div>
        </div>

        {/* 에디터 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </label>
          {loaded ? (
            <FullEditor
              initialContent={contentHtml}
              onChange={setContentHtml}
              placeholder="수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
              disabled={isPending}
              ariaLabel="노트 내용"
              footer={
                <DraftStatus
                  status={status}
                  savedAt={savedAt}
                  restored={restored}
                  recoveries={recoveries}
                  onRestoreRecovery={restoreRecovery}
                  onDiscardRecovery={discardRecovery}
                  disabled={isPending}
                />
              }
              onSave={() => formRef.current?.requestSubmit()}
            />
          ) : null}
        </div>

        {/* 버튼 */}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isPending || !title.trim() || isRichTextEmpty(contentHtml)}
            className="flex-1 gap-2"
          >
            <Save className="w-4 h-4" />
            {isPending ? "저장 중..." : "노트 저장"}
          </Button>
          <Button variant="outline" asChild>
            <Link
              href={returnTo}
              aria-disabled={isPending}
              tabIndex={isPending ? -1 : undefined}
              className={isPending ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                if (isPending) event.preventDefault();
              }}
            >
              취소
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
