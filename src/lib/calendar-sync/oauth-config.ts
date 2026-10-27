/* eslint-disable @typescript-eslint/no-require-imports */

/** OpenNext Worker binding과 Node development 환경 모두에서 문자열 설정값을 읽는다. */
export function readCalendarSyncEnv(name: string): string | undefined {
  let value = process.env[name];
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const binding = getCloudflareContext()?.env?.[name];
    if (typeof binding === "string") value = binding;
  } catch {
    // Node runtime에서는 process.env contract를 사용한다.
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
