import { cookies } from "next/headers";
import {
  BROWSER_SESSION_SCOPE,
  isBrowserScopedSession,
  isSessionTokenCookieName,
  SESSION_SCOPE_COOKIE,
} from "@/lib/session-persistence";

/** 현재 요청의 session이 '로그인 유지'를 켠 로그인인지 확인한다. 비밀번호 변경 뒤 재로그인이 같은 선택을 잇는다. */
export async function isRememberedSession(): Promise<boolean> {
  return !isBrowserScopedSession((await cookies()).get(SESSION_SCOPE_COOKIE)?.value);
}

/**
 * server action의 `signIn` 직후 호출한다. 유지를 끄면 방금 발급된 session cookie를 만료 없이 다시 쓰고
 * 표시 cookie를 남긴다. Auth.js와 같은 속성(httpOnly·lax·path)을 쓰고 `__Secure-` 이름이면 secure를 붙인다.
 */
export async function applySessionPersistence(remember: boolean): Promise<void> {
  const jar = await cookies();
  if (remember) {
    jar.delete(SESSION_SCOPE_COOKIE);
    return;
  }

  let secure = false;
  for (const cookie of jar.getAll()) {
    if (!isSessionTokenCookieName(cookie.name) || !cookie.value) continue;
    const isSecureName = cookie.name.startsWith("__Secure-");
    secure ||= isSecureName;
    jar.set(cookie.name, cookie.value, { httpOnly: true, sameSite: "lax", path: "/", secure: isSecureName });
  }
  jar.set(SESSION_SCOPE_COOKIE, BROWSER_SESSION_SCOPE, { httpOnly: true, sameSite: "lax", path: "/", secure });
}

export async function clearSessionPersistence(): Promise<void> {
  (await cookies()).delete(SESSION_SCOPE_COOKIE);
}
