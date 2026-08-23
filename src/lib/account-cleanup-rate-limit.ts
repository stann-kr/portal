export const ACCOUNT_CLEANUP_STATUS_PATH = "/api/account-cleanup/status";

export interface AccountCleanupRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

function jsonFailure(status: 429 | 503, retryAfter: number): Response {
  return new Response(JSON.stringify({ ok: false }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(retryAfter),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** 익명 cleanup status 요청만 token 본문을 읽기 전에 edge-local로 제한한다. */
export async function enforceAccountCleanupStatusRateLimit(
  request: Request,
  limiter: AccountCleanupRateLimiter,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== ACCOUNT_CLEANUP_STATUS_PATH
  ) {
    return null;
  }

  const connectingIp = request.headers.get("CF-Connecting-IP")?.trim();
  const key = connectingIp || "missing-cloudflare-client-address";
  try {
    const result = await limiter.limit({ key });
    return result.success ? null : jsonFailure(429, 60);
  } catch {
    return jsonFailure(503, 10);
  }
}
