import { Clock, CheckCircle2, XCircle } from "lucide-react";
import type { QnaStatus } from "@/db/schema";
import { PORTAL_STATUS, STATUS_TONE_CLASS_NAMES } from "@/lib/portal-status";

export const QNA_STATUS_LABELS: Record<QnaStatus, string> = {
  OPEN: PORTAL_STATUS.qnaOpen.label,
  ANSWERED: PORTAL_STATUS.qnaAnswered.label,
  CLOSED: PORTAL_STATUS.qnaClosed.label,
};

export const QNA_STATUS_CONFIG: Record<
  QnaStatus,
  { label: string; color: string; iconClassName: string; Icon: React.ElementType }
> = {
  OPEN: {
    label: QNA_STATUS_LABELS.OPEN,
    color: STATUS_TONE_CLASS_NAMES.warning,
    iconClassName: "text-warning",
    Icon: Clock,
  },
  ANSWERED: {
    label: QNA_STATUS_LABELS.ANSWERED,
    color: STATUS_TONE_CLASS_NAMES.success,
    iconClassName: "text-success",
    Icon: CheckCircle2,
  },
  CLOSED: {
    label: QNA_STATUS_LABELS.CLOSED,
    color: STATUS_TONE_CLASS_NAMES.neutral,
    iconClassName: "text-muted-foreground",
    Icon: XCircle,
  },
};

export const QNA_FILTER_TABS = [
  { id: "ALL", label: "전체" },
  { id: "OPEN", label: QNA_STATUS_LABELS.OPEN },
  { id: "ANSWERED", label: QNA_STATUS_LABELS.ANSWERED },
  { id: "CLOSED", label: QNA_STATUS_LABELS.CLOSED },
] as const;

export type QnaFilterTab = (typeof QNA_FILTER_TABS)[number]["id"];
