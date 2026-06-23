/**
 * @file src/components/notes/NoteFullForm.tsx
 * @description 노트 작성 풀 페이지 클라이언트 폼.
 * 서버 컴포넌트에서 createPrivateNote.bind(null, studentId)로 바인딩된 action을 받아 사용.
 */
"use client";

import { useActionState, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateNoteState } from "@/lib/actions/privateNotes";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);

interface NoteFullFormProps {
  /** createPrivateNote.bind(null, studentId) */
  action: (prev: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
}

export function NoteFullForm({ action }: NoteFullFormProps) {
  const [contentHtml, setContentHtml] = useState("");
  const [state, formAction, isPending] = useActionState<CreateNoteState, FormData>(
    action,
    {}
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-6 px-4">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href="/dashboard/student"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          포털로 돌아가기
        </Link>
        <h1 className="text-2xl font-semibold mt-2">노트 작성</h1>
      </div>

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="contentHtml" value={contentHtml} />

        {state?.error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {state.error}
          </div>
        )}

        {state?.success && (
          <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
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
              defaultValue={new Date().toISOString().slice(0, 10)}
              disabled={isPending}
            />
          </div>
        </div>

        {/* 에디터 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </label>
          <FullEditor
            onChange={setContentHtml}
            placeholder="수업 내용, 연습 기록, 메모 등을 자유롭게 작성하세요..."
            disabled={isPending}
          />
        </div>

        {/* 버튼 */}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isPending || !contentHtml}
            className="flex-1 gap-2"
          >
            <Save className="w-4 h-4" />
            {isPending ? "저장 중..." : "노트 저장"}
          </Button>
          <Button variant="outline" asChild disabled={isPending}>
            <Link href="/dashboard/student">취소</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
