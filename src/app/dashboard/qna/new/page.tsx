/**
 * @file src/app/dashboard/qna/new/page.tsx
 * @description 새 Q&A 질문 작성 페이지 (학생 전용).
 */
"use client";

import { useActionState, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createQnaThread, type CreateThreadState } from "@/lib/actions/qna";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);

function NewThreadForm() {
  const [contentHtml, setContentHtml] = useState("");
  const [state, action, isPending] = useActionState<CreateThreadState, FormData>(
    createQnaThread,
    {},
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-6 px-4">
      <div className="space-y-1">
        <Link
          href="/dashboard/qna"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Q&amp;A
        </Link>
        <h1 className="text-2xl font-semibold mt-2">새 질문 작성</h1>
      </div>

      <form action={action} className="space-y-5">
        <input type="hidden" name="contentHtml" value={contentHtml} />

        {state?.error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {state.error}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium">
            제목 <span className="text-destructive">*</span>
          </label>
          <Input
            id="title"
            name="title"
            placeholder="질문 제목을 입력하세요"
            required
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </label>
          <FullEditor
            onChange={setContentHtml}
            placeholder="질문 내용을 자세히 작성하세요. 악보, 코드, 이미지 등을 첨부할 수 있습니다."
            disabled={isPending}
          />
        </div>

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isPending || !contentHtml}
            className="flex-1 gap-2"
          >
            <Send className="w-4 h-4" />
            {isPending ? "등록 중..." : "질문 등록"}
          </Button>
          <Button variant="outline" asChild disabled={isPending}>
            <Link href="/dashboard/qna">취소</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewQnaPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground text-sm">로딩 중...</div>}>
      <NewThreadForm />
    </Suspense>
  );
}
