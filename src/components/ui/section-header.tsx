import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 캔버스 섹션 머리: 13/20 600 글자 2 제목과 Mono 개수, 오른쪽 12px 보조 행동, 아래 1px 선.
 */
export function SectionHeader({
  title,
  titleId,
  count,
  description,
  action,
  className,
}: {
  title: string;
  titleId?: string;
  /** 제목 옆 Mono 개수(예: 오늘 2, 커리큘럼 3 / 8). */
  count?: ReactNode;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 border-b border-border pb-2", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={titleId} className="min-w-0 text-ui font-semibold text-secondary-foreground">
          {title}
          {count !== undefined && count !== null ? (
            <span className="ml-1.5 font-mono font-normal text-muted-foreground">{count}</span>
          ) : null}
        </h2>
        {action ? <div className="shrink-0 text-xs text-secondary-foreground">{action}</div> : null}
      </div>
      {description ? (
        <p className="max-w-[60ch] text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
