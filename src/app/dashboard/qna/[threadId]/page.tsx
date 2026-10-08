/**
 * @file src/app/dashboard/qna/[threadId]/page.tsx
 * @description Q&A 스레드 상세 페이지. 답변 목록 + 작성 폼.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { getQnaThreadIncludingTrash } from "@/lib/actions/qna";
import { ThreadDetailClient } from "@/components/qna/ThreadDetailClient";
import type { QnaStatus } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";

type QnaReply = NonNullable<Awaited<ReturnType<typeof getQnaThreadIncludingTrash>>>["replies"][number];

export default async function QnaThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user) redirect("/login");

  const { threadId } = await params;
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/dashboard/qna");
  const thread = await getQnaThreadIncludingTrash(threadId);
  if (!thread) redirect("/dashboard/qna");

  const isAdmin = session.user.role === "admin";
  const status = thread.status as QnaStatus;

  const studentName =
    thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "학생";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <ThreadDetailClient
        threadId={threadId}
        status={status}
        version={thread.version}
        deletedAt={thread.deletedAt?.toISOString() ?? null}
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
