import { readRuntimeEnv } from "@/lib/runtime-env";

/**
 * OpenNext Worker binding과 Node development 환경 모두에서 문자열 설정값을 읽는다.
 * 예약 실행처럼 `runWithCalendarSyncEnv`로 Worker env를 넘긴 경우 그 값을 먼저 쓴다.
 */
export function readCalendarSyncEnv(name: string): string | undefined {
  return readRuntimeEnv(name);
}

export type GoogleCalendarOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/calendar-connections/google/callback";

/**
 * Google Calendar 연동용 OAuth client(로그인용 Google provider와 별개).
 * GOOGLE_CALENDAR_CLIENT_ID·GOOGLE_CALENDAR_CLIENT_SECRET·AUTH_URL 중 하나라도 없으면 null(기능 꺼짐).
 */
export function getGoogleCalendarOAuthConfig(): GoogleCalendarOAuthConfig | null {
  const clientId = readCalendarSyncEnv("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = readCalendarSyncEnv("GOOGLE_CALENDAR_CLIENT_SECRET");
  const authUrl = readCalendarSyncEnv("AUTH_URL");
  if (!clientId || !clientSecret || !authUrl) return null;
  let origin: string;
  try {
    origin = new URL(authUrl).origin;
  } catch {
    return null;
  }
  return { clientId, clientSecret, redirectUri: `${origin}${GOOGLE_CALENDAR_CALLBACK_PATH}` };
}
