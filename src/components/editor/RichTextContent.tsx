import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { ZoomableRichText } from "./ZoomableRichText";

/**
 * 저장된 rich text의 읽기 화면. 기본 글자는 문서 본문 16/28이고, 화면이 `className`으로 크기를 바꿀 수 있다.
 * 서버 컴포넌트에서도 쓰이므로 정화는 여기서 하고, 이미지 전체화면 보기만 client root(ZoomableRichText)가 맡는다.
 */
export function RichTextContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const sanitizedHtml = sanitizeHtml(html);

  return (
    <ZoomableRichText
      html={sanitizedHtml}
      className={cn("rich-text max-w-none text-base leading-7 text-foreground", className)}
    />
  );
}
