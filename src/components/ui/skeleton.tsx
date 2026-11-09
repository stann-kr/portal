import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 스켈레톤 기본 조각. 색·빛 띠·나타나기·움직임 줄이기 규칙은 skeleton.css가 갖는다.
 * 막대 하나하나는 화면 읽기 프로그램에 보이지 않고, 감싸는 SkeletonRegion이 "불러오는 중"을 한 번 알린다.
 */
export function SkeletonBar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton-bar h-3.5", className)} />;
}

export function SkeletonCircle({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton-bar shrink-0 rounded-full", className)} />;
}

/** 파형·입력칸·카드처럼 면적이 있는 조각. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton-bar rounded-lg", className)} />;
}

/** 스켈레톤 전체를 감싸 접근 가능한 불러오기 상태로 알린다. 160ms 뒤 서서히 나타난다. */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={label} className={cn("skeleton-region", className)}>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
