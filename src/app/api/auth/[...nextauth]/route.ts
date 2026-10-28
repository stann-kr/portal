import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { SESSION_SCOPE_COOKIE, withBrowserScopedSessionCookies } from "@/lib/session-persistence";

/** session 조회·갱신 응답도 '로그인 유지'를 끈 로그인이면 브라우저 session cookie로 둔다. */
function scoped(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest) =>
    withBrowserScopedSessionCookies(request.cookies.get(SESSION_SCOPE_COOKIE)?.value, await handler(request)) as Response;
}

export const GET = scoped(handlers.GET);
export const POST = scoped(handlers.POST);
