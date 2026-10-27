import type { ReactNode } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";

/**
 * 캔버스 목록 구역 머리(학생 홈·관리자 업무함·학생 상세 공용). 공통 SectionHeader에
 * 좁은 화면 보드(MobileHome·MobileAdminWork)의 44px 머리 줄 높이만 더한다.
 */
export function LedgerSectionHeader({
  id,
  title,
  count,
  aside,
  className,
}: {
  id?: string;
  title: string;
  count?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <SectionHeader
      titleId={id}
      title={title}
      count={count}
      action={aside}
      className={cn("max-md:h-11 max-md:justify-center max-md:pb-0", className)}
    />
  );
}

/** 구역 머리 오른쪽 링크·버튼. 좁은 화면은 44px 터치 높이와 13px, 넓은 화면은 12px 글자 2. */
export const LEDGER_HEADER_LINK_CLASS =
  "flex h-11 shrink-0 items-center rounded-sm pl-4 text-ui text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:h-auto md:pl-0 md:text-xs";

/** 구역 머리 오른쪽의 안내 글자(링크가 아닌 값). */
export const LEDGER_HEADER_NOTE_CLASS = "shrink-0 text-xs text-muted-foreground";

/** 목록 행 공통: 1px `muted` 아래 선, hover 면, 보이는 초점. */
export const LEDGER_ROW_CLASS =
  "border-b border-muted text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none";

/** 목록 끝의 조용한 행 버튼(새 노트·모듈 추가처럼 + 아이콘과 13px 글자 3). */
export const LEDGER_ADD_ROW_CLASS =
  "inline-flex h-11 items-center gap-2 self-start rounded-sm px-0 text-body text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:h-10 md:px-1 md:text-ui md:text-muted-foreground";

/** 화면 구역(섹션 머리 + 목록). */
export function LedgerSection({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn("flex min-w-0 flex-col", className)}>
      {children}
    </section>
  );
}

/** 목록이 비었을 때의 한 줄 안내. 바로 이어서 할 행동을 함께 둔다. */
export function LedgerEmptyRow({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted py-3 text-body text-muted-foreground md:px-1">
      <span>{children}</span>
      {actions ? <span className="flex flex-wrap items-center gap-3">{actions}</span> : null}
    </div>
  );
}

/** 빈 안내 줄 안의 이어서 할 행동 링크. */
export const LEDGER_INLINE_LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-sm text-ui text-secondary-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0";
