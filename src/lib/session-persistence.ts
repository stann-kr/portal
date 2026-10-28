/**
 * @file session-persistence.ts
 * @description 로그인 화면의 '로그인 유지' 선택을 session cookie 수명에 반영한다.
 * Auth.js는 session cookie에 항상 만료를 붙인다. 유지를 끈 로그인은 표시 cookie를 함께 두고,
 * session cookie를 새로 쓰는 응답(proxy 갱신·auth route)에서 만료를 떼어 브라우저를 닫으면 사라지게 한다.
 * 표시 cookie도 브라우저 session cookie라 함께 사라진다.
 */

/** 값이 `BROWSER_SESSION_SCOPE`이면 session cookie를 브라우저 session으로만 쓴다. */
export const SESSION_SCOPE_COOKIE = "portal-session-scope";
export const BROWSER_SESSION_SCOPE = "browser";

const SESSION_TOKEN_COOKIE_NAME = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/u;

export function isSessionTokenCookieName(name: string): boolean {
  return SESSION_TOKEN_COOKIE_NAME.test(name);
}

export function isBrowserScopedSession(scope: string | undefined): boolean {
  return scope === BROWSER_SESSION_SCOPE;
}

/**
 * Set-Cookie 한 줄에서 session token cookie의 만료를 뗀다. 지우는 cookie(Max-Age=0·지난 만료)는
 * 그대로 두어 로그아웃과 chunk 정리가 계속 동작하게 한다.
 */
export function withoutSessionCookieExpiry(setCookie: string, now = Date.now()): string {
  const [pair, ...attributes] = setCookie.split(";");
  const name = pair.slice(0, pair.indexOf("=")).trim();
  if (!isSessionTokenCookieName(name)) return setCookie;

  let removesCookie = false;
  const kept = attributes.filter((attribute) => {
    const [key, ...rest] = attribute.trim().split("=");
    const value = rest.join("=");
    const lowerKey = key.toLowerCase();
    if (lowerKey === "max-age") {
      if (Number(value) <= 0) removesCookie = true;
      return false;
    }
    if (lowerKey === "expires") {
      if (Date.parse(value) <= now) removesCookie = true;
      return false;
    }
    return true;
  });
  if (removesCookie) return setCookie;
  return [pair, ...kept].join(";");
}

/** 유지를 끈 로그인이면 응답의 session cookie를 브라우저 session cookie로 바꾼다. */
export function withBrowserScopedSessionCookies(
  scope: string | undefined,
  response: Response | undefined,
): Response | undefined {
  if (!response || !isBrowserScopedSession(scope)) return response;
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) return response;

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const setCookie of setCookies) headers.append("set-cookie", withoutSessionCookieExpiry(setCookie));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
