import { notFound, redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getQnaThreadEvents,
  getQnaThreadIncludingTrash,
} from "@/lib/actions/qna";
import { safeReturnPath } from "@/lib/safe-return-path";
import { RichTextContent } from "@/components/editor/RichTextContent";
import {
  HistoryRecordItem,
  RECORD_ACTION_CELL,
  RECORD_FULL_ROW,
  RecordDetails,
  RecordList,
  RecordMeta,
  RecordPageFrame,
} from "@/components/notes/DocumentRecordFrame";
import { formatRecordTime } from "@/components/notes/note-display";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";
import { getRequestNow } from "@/lib/request-time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Q&A 변경 이력" };

const EVENT_LABELS = {
  BASELINE: "기존 Q&A 이관",
  CREATE: "질문 생성",
  APPEND_REPLY: "답변 추가",
  SET_STATUS: "상태 변경",
  TRASH: "휴지통 이동",
  RESTORE_TRASH: "휴지통 복원",
} as const;

/** Q&A 변경 이력. 노트 변경 이력(NoteHistory 보드)과 같은 틀이며, 복원 대신 그 시점의 상태를 보인다. */
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
  const now = getRequestNow();

  return (
    <RecordPageFrame
      width="history"
      back={{ href: threadHref, label: "Q&A로 돌아가기" }}
      title="변경 이력"
      subtitle={<>{thread.title} · 현재 <span className="font-mono">{thread.version}</span>번 이벤트</>}
      description="질문 생성, 답변 추가, 상태 변경과 휴지통 작업을 발생 순서대로 보존합니다."
    >
      <RecordList ordered label="Q&A 변경 이력">
        {events.map((event) => (
          <HistoryRecordItem
            key={event.id}
            number={event.eventNumber}
            changeLabel={EVENT_LABELS[event.eventType]}
            meta={<RecordMeta time={formatRecordTime(event.createdAt, now)} actor={event.actorName ?? "시스템"} />}
            action={
              <span className={cn(RECORD_ACTION_CELL, "inline-flex h-7 items-center rounded-md bg-muted px-2.5 text-xs text-secondary-foreground")}>
                {QNA_STATUS_LABELS[event.status]}
              </span>
            }
          >
            <p className={cn(RECORD_FULL_ROW, "text-ui text-foreground")}>{event.title}</p>
            {event.replyContentHtml ? (
              <RecordDetails summary="이 이벤트의 답변 보기">
                <RichTextContent html={event.replyContentHtml} className="text-body text-secondary-foreground" />
                {event.replyAttachmentUrl ? (
                  <a
                    href={event.replyAttachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-fit rounded-sm text-xs text-foreground underline underline-offset-4 hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    첨부 파일 열기
                  </a>
                ) : null}
              </RecordDetails>
            ) : null}
            {event.deletedAt ? (
              <p className={cn(RECORD_FULL_ROW, "text-xs text-muted-foreground")}>
                삭제 시각: <span className="font-mono">{formatRecordTime(event.deletedAt, now)}</span>
              </p>
            ) : null}
          </HistoryRecordItem>
        ))}
      </RecordList>
    </RecordPageFrame>
  );
}
