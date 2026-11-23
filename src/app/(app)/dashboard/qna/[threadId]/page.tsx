/**
 * @file src/app/(app)/dashboard/qna/[threadId]/page.tsx
 * @description Q&A 스레드 상세 페이지(캔버스 QnaThread·MobileQnaThread 보드). 답변 목록 + 작성 폼.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { getOpenQnaQueue, getQnaThreadIncludingTrash } from "@/lib/actions/qna";
import { ADMIN_WORK_QUEUE_PATH, buildQnaQueueHref, getNextOpenThread } from "@/lib/admin-work-queue";
import type { QueueNext } from "@/components/admin/assignments/AssignmentReviewControls";
import { ThreadDetailClient } from "@/components/qna/ThreadDetailClient";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";
import { CollabNotifyRefresh } from "@/components/app-shell/CollabNotifyRefresh";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";
import type { QnaStatus } from "@/db/schema";
import { safeReturnPath } from "@/lib/safe-return-path";

type QnaReply = NonNullable<Awaited<ReturnType<typeof getQnaThreadIncludingTrash>>>["replies"][number];

export const metadata = { title: "Q&A 대화" };

export default async function QnaThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ returnTo?: string; from?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user) redirect("/login");

  const { threadId } = await params;
  const query = await searchParams;
  // 알림 room이 "그린 뒤의 변경"을 따라잡는 기준 시각.
  const renderedAt = new Date().getTime();
  const returnTo = safeReturnPath(query.returnTo, "/dashboard/qna");
  const thread = await getQnaThreadIncludingTrash(threadId);
  if (!thread) redirect("/dashboard/qna");

  const isAdmin = session.user.role === "admin";
  const status = thread.status as QnaStatus;

  // 업무함에서 연 질문에 답하면(답변 대기가 아니게 되면) 업무함 순서의 다음 미답변 질문으로 이어 준다(캔버스 UxReview1120Admin ①).
  // Q&A 목록·알림에서 연 경우(from=work 없음)에는 보이지 않는다.
  let queueNext: QueueNext | undefined;
  if (isAdmin && query.from === "work" && status !== "OPEN" && !thread.deletedAt) {
    const open = await getOpenQnaQueue().catch(() => null);
    if (open) {
      const { remaining, next } = getNextOpenThread(open, threadId);
      queueNext = {
        remaining,
        queueHref: returnTo,
        next: next
          ? {
              href: buildQnaQueueHref(next.id, returnTo),
              label: `${next.studentName?.trim() || next.studentEmail?.split("@")[0] || "이름 미등록"} · ${next.title}`,
            }
          : null,
      };
    }
  }

  const studentName =
    thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "학생";

  return (
    <div className="flex min-h-[calc(100dvh-var(--app-topbar-height))] flex-col md:block md:min-h-0 px-5 pb-8 pt-5 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <div className="flex max-w-[760px] flex-1 flex-col md:block md:mx-auto">
        {/* 다른 창의 답글·상태 변경을 새로고침 없이 바로 받는다. 알림이 끊겨도 30초 재조회로 따라온다. */}
        <CollabNotifyRefresh topic="qna" id={threadId} since={renderedAt} />
        <RouteAutoRefresh />
        <ThreadDetailClient
          threadId={threadId}
          status={status}
          version={thread.version}
          deletedAt={thread.deletedAt?.toISOString() ?? null}
          restoreLocked={thread.restoreLocked}
          replies={thread.replies.map((r: QnaReply) => ({
            ...r,
            authorRole: r.authorRole ?? null,
          }))}
          isAdmin={isAdmin}
          isAuthor={!isAdmin && thread.studentId === session.user.id}
          actorId={session.user.id!}
          title={thread.title}
          studentName={studentName}
          studentHref={isAdmin ? buildAdminStudentDetailHref(thread.studentId, "qna") : null}
          createdAt={thread.createdAt?.toISOString() ?? null}
          returnTo={returnTo}
          backToWorkQueue={returnTo === ADMIN_WORK_QUEUE_PATH}
          queueNext={queueNext}
          guideAnchor={thread.guideAnchor}
        />
      </div>
    </div>
  );
}
