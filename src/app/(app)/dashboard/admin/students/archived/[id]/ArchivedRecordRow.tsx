"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 보기 전용 상세의 한 줄(캔버스 UxReview1120Policies ⑩). 누르면 그 자리에서 본문을 펼친다.
 * 본문은 서버가 그려 넘기고(정화한 저장 HTML), 여기서는 열고 닫기만 맡는다.
 */
export function ArchivedRecordRow({
  title,
  meta,
  children,
}: {
  title: string;
  /** 오른쪽 날짜("11.11"). */
  meta: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2.5 border-b border-muted py-2 text-left text-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:text-body"
      >
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.8}
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className={cn("min-w-0 flex-1 break-words", open && "font-medium")}>{title}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{meta}</span>
      </button>
      <div id={bodyId} hidden={!open} className="border-b border-muted pb-4 pl-6 pt-3">
        {open ? children : null}
      </div>
    </li>
  );
}
