/**
 * @file src/app/dashboard/qna/[threadId]/page.tsx
 * @description Q&A 스레드 상세 페이지. 답변 목록 + 작성 폼.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getQnaThread } from "@/lib/actions/qna";
import { ThreadDetailClient } from "@/components/qna/ThreadDetailClient";
import type { QnaStatus } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";

type QnaReply = NonNullable<Awaited<ReturnType<typeof getQnaThread>>>["replies"][number];

export default async function QnaThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { threadId } = await params;
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/dashboard/qna");
  const thread = await getQnaThread(threadId);
  if (!thread) redirect("/dashboard/qna");

  const isAdmin = session.user.role === "admin";
  const status = thread.status as QnaStatus;

  const studentName =
    thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "학생";

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6">
      <ThreadDetailClient
        threadId={threadId}
        status={status}
        replies={thread.replies.map((r: QnaReply) => ({
          ...r,
          authorRole: r.authorRole ?? null,
        }))}
        isAdmin={isAdmin}
        actorId={session.user.id!}
        title={thread.title}
        studentName={studentName}
        createdAt={thread.createdAt?.toISOString() ?? null}
        returnTo={returnTo}
      />
    </div>
  );
}
