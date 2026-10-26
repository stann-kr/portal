import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 홈 화면 공통 행 스타일: 얇은 hover 면과 보이는 focus ring. */
export const HOME_ROW_CLASS =
  "group flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors duration-[var(--duration-fast)] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

/** 홈 화면 보조 링크(섹션 머리글 오른쪽). */
export const HOME_ACTION_LINK_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Notion처럼 조용한 소제목과 얇은 구분선으로 묶는 홈 화면 구역. */
export function HomeSection({
  id,
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex min-h-8 items-center justify-between gap-3 border-b border-border pb-1.5">
        <h2 id={id} className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 목록이 비었을 때의 한 줄 안내. 바로 이어서 할 행동을 함께 둔다. */
export function HomeEmptyRow({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-sm text-muted-foreground">
      <span>{children}</span>
      {actions ? <span className="flex flex-wrap items-center gap-1">{actions}</span> : null}
    </div>
  );
}
