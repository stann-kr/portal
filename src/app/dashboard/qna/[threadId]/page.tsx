/**
 * @file src/app/dashboard/qna/[threadId]/page.tsx
 * @description Q&A 스레드 상세 페이지(캔버스 QnaThread·MobileQnaThread 보드). 답변 목록 + 작성 폼.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { getQnaThreadIncludingTrash } from "@/lib/actions/qna";
import { ThreadDetailClient } from "@/components/qna/ThreadDetailClient";
import type { QnaStatus } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";

type QnaReply = NonNullable<Awaited<ReturnType<typeof getQnaThreadIncludingTrash>>>["replies"][number];

export const metadata = { title: "Q&A 대화" };

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
    <div className="flex min-h-[calc(100dvh-var(--app-topbar-height))] flex-col md:block md:min-h-0 px-5 pb-8 pt-5 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <div className="flex max-w-[760px] flex-1 flex-col md:block">
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
          guideAnchor={thread.guideAnchor}
        />
      </div>
    </div>
  );
}
