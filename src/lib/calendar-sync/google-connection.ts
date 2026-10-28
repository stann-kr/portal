/**
 * Google 연결 완료(code 교환 → 자격 증명 암호화 저장).
 *
 * 공개 server action이 아니다("use server" 파일에 두면 누구나 임의 code·verifier로 부를 수 있어 callback의
 * 봉인된 state·만료·시작 관리자 검사를 우회한다). state·PKCE 검증을 끝낸 OAuth callback route만 부른다.
 * 그래도 방어적으로 관리자 session을 다시 확인한다.
 */
import { revalidatePath } from "next/cache";
import { createDbContext, type DrizzleDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth-guard";
import type { CalendarSyncFormState } from "@/lib/actions/calendarSync";
import { isCalendarEncryptionConfigured, requireCalendarEncryptionKey } from "./client-factory";
import { upsertCalendarConnection } from "./connection-store";
import { CALENDAR_SYNC_MESSAGES, CalendarSyncConfigError } from "./engine";
import { exchangeGoogleCode, fetchGoogleAccountLabel } from "./google";
import { getGoogleCalendarOAuthConfig } from "./oauth-config";
import { CalendarAuthError } from "./types";

const SETTINGS_PATH = "/dashboard/admin/calendar-sync";
const MESSAGES = {
  googleFailed: "Google 계정을 연결하지 못했습니다. 다시 시도해 주세요.",
  googleNoRefresh: "Google이 장기 사용 권한을 주지 않았습니다. 연결을 다시 시도해 주세요.",
  googleScope: "Google 캘린더 권한이 허용되지 않았습니다. 권한을 모두 허용하고 다시 연결해 주세요.",
} as const;

/** OAuth callback route가 state·PKCE 검증을 끝낸 뒤 code와 verifier만 넘긴다. */
export async function completeGoogleCalendarConnection(input: {
  code: string;
  codeVerifier: string;
}): Promise<CalendarSyncFormState> {
  const session = await requireAdmin();
  const config = getGoogleCalendarOAuthConfig();
  if (!config) return { error: CALENDAR_SYNC_MESSAGES.googleNotConfigured };
  if (!isCalendarEncryptionConfigured()) return { error: CALENDAR_SYNC_MESSAGES.encryptionMissing };
  const code = typeof input?.code === "string" ? input.code : "";
  const codeVerifier = typeof input?.codeVerifier === "string" ? input.codeVerifier : "";
  if (!code || !codeVerifier) return { error: MESSAGES.googleFailed };
  try {
    const tokens = await exchangeGoogleCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
      codeVerifier,
    });
    if (!tokens.refreshToken) return { error: MESSAGES.googleNoRefresh };
    const label = await fetchGoogleAccountLabel({ accessToken: tokens.accessToken }).catch(() => null);
    await upsertCalendarConnection(createDbContext().db as unknown as DrizzleDb, {
      ownerId: session.user.id,
      provider: "GOOGLE",
      accountLabel: label?.trim() || "Google 계정",
      credentials: {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt.getTime(),
      },
      key: requireCalendarEncryptionKey(),
    });
  } catch (error) {
    if (error instanceof CalendarAuthError && error.reason === "insufficient_scope") return { error: MESSAGES.googleScope };
    if (error instanceof CalendarSyncConfigError) return { error: error.message };
    return { error: MESSAGES.googleFailed };
  }
  revalidatePath(SETTINGS_PATH);
  return { success: "Google 계정을 연결했습니다. 학생마다 캘린더를 지정해 주세요." };
}
