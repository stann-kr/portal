import { cn } from "@/lib/utils";
import {
  getPortalStatus,
  STATUS_TONE_DOT_CLASS_NAMES,
  type PortalStatusKey,
} from "@/lib/portal-status";

/**
 * 캔버스 상태 표시: 6px 점 + 이름(예: 답변 대기 = Q&A 노란 점). 면·선 없이 글자는 글자 2.
 * 점 색은 registry tone에서 정하고, 크기·색을 바꿔야 하면 `className`으로 덮어쓴다.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: PortalStatusKey;
  className?: string;
}) {
  const definition = getPortalStatus(status);

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap text-ui text-secondary-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS_NAMES[definition.tone])}
      />
      {definition.label}
    </span>
  );
}
