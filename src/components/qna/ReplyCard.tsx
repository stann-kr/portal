/**
 * @file src/components/qna/ReplyCard.tsx
 * @description Q&A 개별 답변 카드.
 * 작성자 역할별 스타일 구분: 어드민(우측/강조) vs 학생(좌측/기본).
 */
import { ExternalLink } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { formatKst } from "@/lib/kst-format";

type Reply = {
  id: string;
  contentHtml: string;
  attachmentUrl: string | null | undefined;
  createdAt: Date | null | undefined;
  authorName: string | null | undefined;
  authorEmail: string | null | undefined;
  authorRole: string | null | undefined;
};

interface ReplyCardProps {
  reply: Reply;
}

export function ReplyCard({ reply }: ReplyCardProps) {
  const isAdmin = reply.authorRole === "admin";
  const author =
    reply.authorName ?? reply.authorEmail?.split("@")[0] ?? "이름 미등록";
  const date = formatKst(reply.createdAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, "작성일 미정");

  return (
    <div className={`flex gap-3 ${isAdmin ? "flex-row-reverse" : "flex-row"}`}>
      {/* 아바타 */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-1 ${
          isAdmin
            ? "bg-primary text-primary-foreground"
            : "bg-muted border border-border text-foreground"
        }`}
      >
        {author.slice(0, 2).toUpperCase()}
      </div>

      {/* 말풍선 */}
      <div className={`flex-1 max-w-[80%] ${isAdmin ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{author}</span>
          {isAdmin && (
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-semibold">
              강사
            </span>
          )}
          <span>{date}</span>
        </div>

        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            isAdmin
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted border border-border rounded-tl-sm"
          }`}
        >
          <RichTextContent
            html={reply.contentHtml}
            className={isAdmin ? "text-primary-foreground" : "text-foreground"}
          />
        </div>

        {reply.attachmentUrl && (
          <a
            href={reply.attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            첨부 파일
          </a>
        )}
      </div>
    </div>
  );
}
