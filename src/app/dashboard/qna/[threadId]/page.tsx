/**
 * @file src/app/dashboard/qna/[threadId]/page.tsx
 * @description Q&A 스레드 상세 페이지. 답변 목록 + 작성 폼.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getQnaThread } from "@/lib/actions/qna";
import { ThreadDetailClient } from "@/components/qna/ThreadDetailClient";
import type { QnaStatus } from "@/db/schema";
import { StatusBadge } from "@/components/ui/status-badge";

type QnaReply = NonNullable<Awaited<ReturnType<typeof getQnaThread>>>["replies"][number];

export default async function QnaThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { threadId } = await params;
  const thread = await getQnaThread(threadId);
  if (!thread) redirect("/dashboard/qna");

  const isAdmin = session.user.role === "admin";
  const status = thread.status as QnaStatus;

  const studentName =
    thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "학생";

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6">
      {/* 헤더 */}
      <div className="space-y-2">
        <Link
          href="/dashboard/qna"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Q&A 목록
        </Link>

        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground">{thread.title}</h1>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              {isAdmin && <span>{studentName} /</span>}
              <span>
                {thread.createdAt
                  ? new Date(thread.createdAt).toLocaleDateString("ko-KR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "작성일 미정"}
              </span>
            </div>
          </div>
          <StatusBadge
            status={
              status === "OPEN"
                ? "qnaOpen"
                : status === "ANSWERED"
                  ? "qnaAnswered"
                  : "qnaClosed"
            }
          />
        </div>
      </div>

      {/* 구분선 */}
      <div className="border-t border-border" />

      {/* 답변 목록 + 작성 폼 (클라이언트) */}
      <ThreadDetailClient
        threadId={threadId}
        status={status}
        replies={thread.replies.map((r: QnaReply) => ({
          ...r,
          authorRole: r.authorRole ?? null,
        }))}
        isAdmin={isAdmin}
      />
    </div>
  );
}
