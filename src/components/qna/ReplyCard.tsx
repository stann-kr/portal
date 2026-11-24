/**
 * @file src/components/qna/ReplyCard.tsx
 * @description Q&A 대화의 한 줄(캔버스 QnaThread·MobileQnaThread 보드).
 * 28px 이니셜 원(Stann은 먹색 면), 이름(Stann만 semibold, 학생은 regular)·시각, 본문, 첨부(이미지면 160×120 미리보기와
 * 전체화면 뷰어, 그 밖에는 "첨부 파일 · 형식" 새 창 칩). 역할 배지는 두지 않는다.
 */
import type { ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { cn } from "@/lib/utils";
import { formatKstMonthDayTime } from "@/lib/kst-format";
import { initialOf } from "./qna-display";
import { ReplyAttachmentImage } from "./ReplyAttachmentImage";
import type { MediaAttachmentKind } from "@/lib/media-lifecycle";

type Reply = {
  id: string;
  contentHtml: string;
  attachmentUrl: string | null | undefined;
  /** 서버가 media MIME에서 계산한 첨부 종류. image면 미리보기·뷰어, 그 밖에는 칩. */
  attachmentKind?: MediaAttachmentKind | null;
  /** 서버가 media MIME에서 계산한 짧은 형식 이름(MP3 등). 이미지가 아닌 첨부 칩 글자에 쓴다. */
  attachmentFormat?: string | null;
  createdAt: Date | null | undefined;
  /** 작성자가 본문을 고친 시각(감사 보완 #7). 고친 적 없으면 null. */
  editedAt?: Date | string | null;
  authorName: string | null | undefined;
  authorRole: string | null | undefined;
};

interface ReplyCardProps {
  reply: Reply;
  /** 이름·시각 줄 끝 조작(내 글 "고치기"). */
  action?: ReactNode;
  /** 본문 자리에 대신 그릴 내용(고치는 칸). 첨부는 그대로 둔다. */
  editor?: ReactNode;
}

export function ReplyCard({ reply, action, editor }: ReplyCardProps) {
  const isStann = reply.authorRole === "admin";
  const author = reply.authorName ?? "이름 미등록";
  const time = formatKstMonthDayTime(reply.createdAt, "작성 시각 미정");
  const attachmentName = reply.attachmentUrl?.split("/").pop() || "첨부 파일";
  // 이름을 저장하지 않는 첨부의 주소 끝은 media id라 읽을 수 없다. 형식을 알면 "첨부 파일 · MP3",
  // 모르면 확장자가 있는 옛 파일 이름, 그것도 없으면 "첨부 파일"만 보인다(2026-11-21 사용자 결정, DB 변경 없음).
  const chipLabel = reply.attachmentFormat
    ? `첨부 파일 · ${reply.attachmentFormat}`
    : /\.[a-z0-9]{2,5}$/iu.test(attachmentName) ? attachmentName : "첨부 파일";

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
          {reply.editedAt ? (
            <span className="text-xs text-muted-foreground" title={`고친 시각 ${formatKstMonthDayTime(new Date(reply.editedAt), "")}`}>고침</span>
          ) : null}
          {action ? <span className="ml-auto">{action}</span> : null}
        </p>
        {editor ?? <RichTextContent html={reply.contentHtml} className="text-md leading-6 md:leading-[26px]" />}
        {reply.attachmentUrl && reply.attachmentKind === "image" ? (
          <ReplyAttachmentImage src={reply.attachmentUrl} name={attachmentName} />
        ) : reply.attachmentUrl ? (
          <a
            href={reply.attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex h-9 max-w-full items-center gap-1.5 self-start rounded-touch border border-border px-3 text-ui text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0 md:h-7 md:rounded-md md:px-2.5 md:text-xs md:text-secondary-foreground md:hover:text-foreground"
          >
            <Paperclip className="size-3.5 shrink-0 md:size-[13px]" strokeWidth={1.6} aria-hidden="true" />
            <span className="truncate">{chipLabel}</span>
            <span className="sr-only">(새 창에서 열기)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}
