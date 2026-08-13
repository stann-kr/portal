import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getQnaThreadEvents,
  getQnaThreadIncludingTrash,
} from "@/lib/actions/qna";
import { safeReturnPath } from "@/lib/safe-return-path";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";

export const metadata = { title: "Q&A 변경 이력" };

const EVENT_LABELS = {
  BASELINE: "기존 Q&A 이관",
  CREATE: "질문 생성",
  APPEND_REPLY: "답변 추가",
  SET_STATUS: "상태 변경",
  TRASH: "휴지통 이동",
  RESTORE_TRASH: "휴지통 복원",
} as const;

export default async function QnaHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { threadId } = await params;
  const thread = await getQnaThreadIncludingTrash(threadId);
  if (!thread) notFound();

  const events = await getQnaThreadEvents(threadId);
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/dashboard/qna");
  const threadHref = `/dashboard/qna/${threadId}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href={threadHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Q&amp;A로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Q&amp;A 변경 이력</h1>
            <p className="text-sm text-muted-foreground">
              {thread.title} · 현재 {thread.version}번 이벤트
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          질문 생성, 답변 추가, 상태 변경과 휴지통 작업을 발생 순서대로 보존합니다.
        </p>
      </header>

      <ol className="space-y-4" aria-label="Q&A 변경 이력">
        {events.map((event) => (
          <li key={event.id} className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {event.eventNumber}번 · {EVENT_LABELS[event.eventType]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {event.createdAt.toLocaleString("ko-KR")} · {event.actorName ?? "시스템"}
                </p>
              </div>
              <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                {QNA_STATUS_LABELS[event.status]}
              </span>
            </div>
            <p className="text-sm font-medium">{event.title}</p>
            {event.replyContentHtml ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                  이 이벤트의 답변 보기
                </summary>
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <RichTextContent html={event.replyContentHtml} />
                  {event.replyAttachmentUrl ? (
                    <a
                      href={event.replyAttachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      첨부 파일 열기
                    </a>
                  ) : null}
                </div>
              </details>
            ) : null}
            {event.deletedAt ? (
              <p className="text-xs text-muted-foreground">
                삭제 시각: {event.deletedAt.toLocaleString("ko-KR")}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
