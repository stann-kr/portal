/**
 * Google 캘린더 OAuth callback이 관리자 화면으로 돌려주는 결과 code.
 * 주소에는 고정 code만 싣고 Google·엔진의 오류 문구를 그대로 반사하지 않는다.
 * route(server)와 설정 화면(client)이 함께 쓰므로 server 전용 의존성을 두지 않는다.
 */

export const CALENDAR_SYNC_ADMIN_PATH = "/dashboard/admin/calendar-sync";

export const GOOGLE_OAUTH_ERROR_CODES = [
  "access_denied",
  "provider_error",
  "state_mismatch",
  "expired",
  "wrong_admin",
  "config_missing",
  "exchange_failed",
] as const;

export type GoogleOAuthErrorCode = (typeof GOOGLE_OAUTH_ERROR_CODES)[number];

export type GoogleOAuthResult =
  | { kind: "connected" }
  | { kind: "error"; code: GoogleOAuthErrorCode | "unknown" };

const ERROR_MESSAGES: Record<GoogleOAuthErrorCode | "unknown", string> = {
  access_denied: "Google 계정 연결을 취소했습니다. 필요하면 다시 연결해 주세요.",
  provider_error: "Google이 연결 요청을 거절했습니다. 잠시 후 다시 시도해 주세요.",
  state_mismatch: "연결 요청을 확인하지 못했습니다. 이 화면에서 Google 연결을 다시 시작해 주세요.",
  expired: "연결 요청 시간이 지났습니다. Google 연결을 다시 시작해 주세요.",
  wrong_admin: "연결을 시작한 관리자 계정과 지금 로그인한 계정이 다릅니다. 다시 시작해 주세요.",
  config_missing: "서버에 Google 연동 설정이 없어 연결할 수 없습니다.",
  exchange_failed: "Google 계정을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  unknown: "Google 계정을 연결하지 못했습니다. 다시 시도해 주세요.",
};

export function googleOAuthResultHref(result: { kind: "connected" } | { kind: "error"; code: GoogleOAuthErrorCode }): string {
  const params = new URLSearchParams({ google: result.kind });
  if (result.kind === "error") params.set("message", result.code);
  return `${CALENDAR_SYNC_ADMIN_PATH}?${params.toString()}`;
}

/** 주소의 `google`·`message` 값을 고정 code로만 해석한다. 모르는 값은 일반 오류로 본다. */
export function parseGoogleOAuthResult(
  google: string | string[] | undefined,
  message: string | string[] | undefined,
): GoogleOAuthResult | null {
  const kind = Array.isArray(google) ? google[0] : google;
  if (kind === "connected") return { kind: "connected" };
  if (kind !== "error") return null;
  const raw = Array.isArray(message) ? message[0] : message;
  const code = (GOOGLE_OAUTH_ERROR_CODES as readonly string[]).includes(raw ?? "")
    ? (raw as GoogleOAuthErrorCode)
    : "unknown";
  return { kind: "error", code };
}

export function googleOAuthResultMessage(result: GoogleOAuthResult): string {
  return result.kind === "connected" ? "Google 캘린더 계정을 연결했습니다. 학생별로 동기화할 캘린더를 골라 주세요." : ERROR_MESSAGES[result.code];
}
