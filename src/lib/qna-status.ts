import { Clock, CheckCircle2, XCircle } from "lucide-react";
import type { QnaStatus } from "@/db/schema";

export const QNA_STATUS_LABELS: Record<QnaStatus, string> = {
  OPEN: "미답변",
  ANSWERED: "답변완료",
  CLOSED: "종료",
};

export const QNA_STATUS_CONFIG: Record<
  QnaStatus,
  { label: string; color: string; iconClassName: string; Icon: React.ElementType }
> = {
  OPEN: {
    label: QNA_STATUS_LABELS.OPEN,
    color: "bg-red-500/10 text-red-500",
    iconClassName: "text-red-500",
    Icon: Clock,
  },
  ANSWERED: {
    label: QNA_STATUS_LABELS.ANSWERED,
    color: "bg-green-500/10 text-green-500",
    iconClassName: "text-green-500",
    Icon: CheckCircle2,
  },
  CLOSED: {
    label: QNA_STATUS_LABELS.CLOSED,
    color: "bg-muted text-muted-foreground",
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
