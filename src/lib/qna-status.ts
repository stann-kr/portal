import type { QnaStatus } from "@/db/schema";
import { PORTAL_STATUS } from "@/lib/portal-status";

export const QNA_STATUS_LABELS: Record<QnaStatus, string> = {
  OPEN: PORTAL_STATUS.qnaOpen.label,
  ANSWERED: PORTAL_STATUS.qnaAnswered.label,
  CLOSED: PORTAL_STATUS.qnaClosed.label,
};

export const QNA_FILTER_TABS = [
  { id: "ALL", label: "전체" },
  { id: "OPEN", label: QNA_STATUS_LABELS.OPEN },
  { id: "ANSWERED", label: QNA_STATUS_LABELS.ANSWERED },
  { id: "CLOSED", label: QNA_STATUS_LABELS.CLOSED },
] as const;

export type QnaFilterTab = (typeof QNA_FILTER_TABS)[number]["id"];
