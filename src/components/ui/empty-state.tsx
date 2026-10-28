import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 비어 있는 이유와 다음 행동(캔버스 States 보드 "빈 화면"): 옅은 1px 선의 r10 면,
 * 36px 아이콘 칸·16px 제목·글자 2 설명·보조 행동을 왼쪽 정렬로 쌓는다.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  titleAs: Title = "p",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  /** 화면의 제목 구조 안에서 빈 화면 제목이 heading이어야 하면 지정한다. 기본은 문단. */
  titleAs?: "p" | "h2" | "h3";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-center gap-3 rounded-lg border border-muted bg-background px-6 py-10 md:px-8 md:py-12",
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-touch bg-sidebar text-muted-foreground [&_svg]:size-[18px]">
        {icon ?? <Inbox strokeWidth={1.6} aria-hidden="true" />}
      </div>
      <Title className="text-base font-semibold text-foreground">{title}</Title>
      {description ? (
        <p className="max-w-[300px] text-body text-secondary-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
