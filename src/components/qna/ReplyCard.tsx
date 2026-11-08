/**
 * @file src/components/qna/ReplyCard.tsx
 * @description Q&A 대화의 한 줄(캔버스 QnaThread·MobileQnaThread 보드).
 * 28px 이니셜 원(Stann은 먹색 면), 이름(Stann만 semibold, 학생은 regular)·시각, 본문, 첨부 파일 칩. 역할 배지는 두지 않는다.
 */
import { Paperclip } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { cn } from "@/lib/utils";
import { formatKstMonthDayTime } from "@/lib/kst-format";
import { initialOf } from "./qna-display";
import type { MediaAttachmentKind } from "@/lib/media-lifecycle";

type Reply = {
  id: string;
  contentHtml: string;
  attachmentUrl: string | null | undefined;
  /** 서버가 media MIME에서 계산한 첨부 종류. 이미지 viewer가 쓸 값이며 아직 렌더링에는 쓰지 않는다. */
  attachmentKind?: MediaAttachmentKind | null;
  createdAt: Date | null | undefined;
  authorName: string | null | undefined;
  authorEmail: string | null | undefined;
  authorRole: string | null | undefined;
};

interface ReplyCardProps {
  reply: Reply;
}

export function ReplyCard({ reply }: ReplyCardProps) {
  const isStann = reply.authorRole === "admin";
  const author =
    reply.authorName ?? reply.authorEmail?.split("@")[0] ?? "이름 미등록";
  const time = formatKstMonthDayTime(reply.createdAt, "작성 시각 미정");
  const attachmentName = reply.attachmentUrl?.split("/").pop() || "첨부 파일";

  return (
    <li className="flex gap-3 border-b border-muted py-4 md:gap-3.5 md:py-5">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isStann ? "bg-primary text-primary-foreground" : "bg-selected text-secondary-foreground",
        )}
      >
        {initialOf(author)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 md:gap-1.5">
        <p className="flex flex-wrap items-center gap-2 text-ui">
          <span className={isStann ? "font-semibold" : "font-normal"}>{author}</span>
          <span className="font-mono text-xs text-muted-foreground">{time}</span>
        </p>
        <RichTextContent html={reply.contentHtml} className="text-md leading-6 md:leading-[26px]" />
        {reply.attachmentUrl ? (
          <a
            href={reply.attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex h-9 max-w-full items-center gap-1.5 self-start rounded-touch border border-border px-3 text-ui text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0 md:h-7 md:rounded-md md:px-2.5 md:text-xs md:text-secondary-foreground md:hover:text-foreground"
          >
            <Paperclip className="size-3.5 shrink-0 md:size-[13px]" strokeWidth={1.6} aria-hidden="true" />
            <span className="truncate">{attachmentName}</span>
            <span className="sr-only">(새 창에서 열기)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}
