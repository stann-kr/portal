import { ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN } from "@/lib/account-cleanup-token";

export const ACCOUNT_CLEANUP_REQUEST_MAX_BYTES = 256;

export const ACCOUNT_CLEANUP_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

export type AccountCleanupApiRequest = {
  tokenDigest: string;
};

export type AccountCleanupRequestFailure =
  | "CROSS_ORIGIN"
  | "INVALID_CONTENT_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_PAYLOAD";

export function accountCleanupJson(
  body: unknown,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...ACCOUNT_CLEANUP_RESPONSE_HEADERS,
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  if (origin !== requestOrigin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

/** 익명 status endpoint와 인증 register endpoint가 공유하는 좁은 JSON 경계. */
export async function parseAccountCleanupRequest(
  request: Request,
): Promise<
  | { ok: true; value: AccountCleanupApiRequest }
  | { ok: false; reason: AccountCleanupRequestFailure }
> {
  if (!isSameOrigin(request)) return { ok: false, reason: "CROSS_ORIGIN" };

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { ok: false, reason: "INVALID_CONTENT_TYPE" };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ACCOUNT_CLEANUP_REQUEST_MAX_BYTES
  ) {
    return { ok: false, reason: "PAYLOAD_TOO_LARGE" };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
  if (new TextEncoder().encode(text).byteLength > ACCOUNT_CLEANUP_REQUEST_MAX_BYTES) {
    return { ok: false, reason: "PAYLOAD_TOO_LARGE" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("tokenDigest" in value) ||
    typeof value.tokenDigest !== "string" ||
    !ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN.test(value.tokenDigest)
  ) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }

  return { ok: true, value: { tokenDigest: value.tokenDigest } };
}
