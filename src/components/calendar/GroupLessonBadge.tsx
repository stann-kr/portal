/**
 * @file src/components/calendar/GroupLessonBadge.tsx
 * @description "그룹레슨 · 그룹 이름" 표시(캔버스 UxReview1120Lessons ⑤). 학생 한 명 화면의 레슨 상세와 학생 상세 개요 레슨 줄에 쓴다.
 */
import { cn } from "@/lib/utils";

export function GroupLessonBadge({ groupName, className }: { groupName: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] min-w-0 items-center rounded-full bg-muted px-2 text-xs text-secondary-foreground",
        className,
      )}
    >
      <span className="truncate">그룹레슨 · {groupName}</span>
    </span>
  );
}
