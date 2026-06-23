/**
 * @file src/app/dashboard/qna/page.tsx
 * @description Q&A 스레드 목록 페이지.
 * 학생: 본인 스레드만, 어드민: 전체 + 학생명 표시.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getQnaThreads } from "@/lib/actions/qna";
import { ThreadList } from "@/components/qna/ThreadList";
import type { QnaStatus } from "@/db/schema";

type RawThread = Awaited<ReturnType<typeof getQnaThreads>>[number];

type QnaThreadItem = {
  id: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  studentId: string | null | undefined;
  studentName: string | null | undefined;
  studentEmail: string | null | undefined;
};

export default async function QnaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "admin";
  const rawThreads = await getQnaThreads();

  const threads: QnaThreadItem[] = rawThreads.map((t: RawThread) => ({
    ...t,
    status: t.status as QnaStatus,
  }));

  const openCount = threads.filter((t) => t.status === "OPEN").length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-primary" />
            Q&A
            {openCount > 0 && (
              <span className="w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                {openCount}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "전체 학생의 질문을 관리합니다."
              : "강사에게 질문을 남기고 답변을 받으세요."}
          </p>
        </div>
        {!isAdmin && (
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/dashboard/qna/new">
              <Plus className="w-3.5 h-3.5" />새 질문
            </Link>
          </Button>
        )}
      </div>

      <ThreadList threads={threads} isAdmin={isAdmin} />
    </div>
  );
}
