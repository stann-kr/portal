export type PortalStatusTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "destructive"
  | "info";

export type PortalStatusIcon =
  | "clock"
  | "check"
  | "close"
  | "message"
  | "calendar";

export type PortalStatusKey =
  | "qnaOpen"
  | "qnaAnswered"
  | "qnaClosed"
  | "feedbackWaiting"
  | "feedbackReady"
  | "lessonUpcoming"
  | "complete";

export type PortalStatusDefinition = {
  label: string;
  tone: PortalStatusTone;
  icon: PortalStatusIcon;
};

export const PORTAL_STATUS: Record<PortalStatusKey, PortalStatusDefinition> = {
  qnaOpen: { label: "답변 대기", tone: "warning", icon: "clock" },
  qnaAnswered: { label: "답변 완료", tone: "success", icon: "message" },
  qnaClosed: { label: "종료", tone: "neutral", icon: "close" },
  feedbackWaiting: { label: "피드백 대기", tone: "warning", icon: "clock" },
  feedbackReady: { label: "피드백 도착", tone: "info", icon: "message" },
  lessonUpcoming: { label: "예정", tone: "info", icon: "calendar" },
  complete: { label: "완료", tone: "success", icon: "check" },
};

export const STATUS_TONE_CLASS_NAMES: Record<PortalStatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  accent: "border-primary/20 bg-accent text-accent-foreground",
  success: "border-success/20 bg-success-muted text-success",
  warning: "border-warning/20 bg-warning-muted text-warning",
  destructive: "border-destructive/20 bg-destructive-muted text-destructive",
  info: "border-info/20 bg-info-muted text-info",
};

export function getPortalStatus(key: PortalStatusKey): PortalStatusDefinition {
  return PORTAL_STATUS[key];
}
