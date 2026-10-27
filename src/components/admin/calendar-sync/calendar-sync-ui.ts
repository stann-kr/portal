import type { ExternalCalendarProvider } from "@/db/schema";

export const GOOGLE_CONNECT_HREF = "/api/calendar-connections/google/start";

export const PROVIDER_LABEL: Record<ExternalCalendarProvider, string> = {
  GOOGLE: "Google 캘린더",
  ICLOUD: "iCloud 캘린더",
};

export const CALENDAR_SYNC_MESSAGES = {
  encryptionMissing: "설정 필요: 서버에 EXTERNAL_CALENDAR_ENCRYPTION_KEY가 없어 외부 캘린더 연결이 꺼져 있습니다.",
  googleMissing: "Google 연동 설정(GOOGLE_CALENDAR_CLIENT_ID/SECRET)이 없어 Google 연결이 꺼져 있습니다.",
  unexpected: "결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

// 캔버스 입력과 같은 높이·모서리·초점 선(AssignmentTaskForms의 select와 같은 값).
export const SELECT_CLASS =
  "h-11 w-full min-w-0 rounded-touch border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-8 md:rounded-md md:text-ui";
export const FIELD_LABEL_CLASS = "text-ui font-medium text-foreground";
export const ACTION_BUTTON_CLASS = "h-11 rounded-touch text-body md:h-8 md:rounded-md md:text-ui";
export const NOTICE_CLASS = "rounded-touch border px-3.5 py-2.5 text-body md:text-ui";
