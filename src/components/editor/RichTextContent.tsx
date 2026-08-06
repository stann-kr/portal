import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize-html";

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
      className={cn("rich-text max-w-none text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
