import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize-html";

/** 저장된 rich text의 읽기 화면. 기본 글자는 문서 본문 16/28이고, 화면이 `className`으로 크기를 바꿀 수 있다. */
export function RichTextContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const sanitizedHtml = sanitizeHtml(html);

  return (
    <div
      className={cn("rich-text max-w-none text-base leading-7 text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
