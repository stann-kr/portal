import {
  CalendarClock,
  Check,
  CircleX,
  Clock3,
  MessageCircleReply,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getPortalStatus,
  STATUS_TONE_CLASS_NAMES,
  type PortalStatusIcon,
  type PortalStatusKey,
} from "@/lib/portal-status";

const STATUS_ICONS: Record<PortalStatusIcon, React.ElementType> = {
  clock: Clock3,
  check: Check,
  close: CircleX,
  message: MessageCircleReply,
  calendar: CalendarClock,
};

export function StatusBadge({
  status,
  className,
}: {
  status: PortalStatusKey;
  className?: string;
}) {
  const definition = getPortalStatus(status);
  const Icon = STATUS_ICONS[definition.icon];

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold",
        STATUS_TONE_CLASS_NAMES[definition.tone],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {definition.label}
    </span>
  );
}
