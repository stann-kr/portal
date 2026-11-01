import { COLLAB_LEASE_SECONDS, COLLAB_TOKEN_TTL_SECONDS, type CollabMode } from "./protocol";

/**
 * 공동 편집 연결 토큰. Next route가 세션·문서 권한을 확인한 뒤 발급하고,
 * worker는 서명과 만료만 확인한다(권한 판단을 worker에 복제하지 않는다).
 */
export type CollabTokenClaims = {
  /** 문서 room key(예: `note:<id>`). */
  k: string;
  /** 사용자 id. */
  u: string;
  m: CollabMode;
  /** 만료 시각(초). 이 토큰으로 연결·renew할 수 있는 시한. */
  exp: number;
  /** 발급 시각(ms). renew는 더 새 토큰만 받는다(재사용으로 lease를 늘리지 못한다). */
  i: number;
  /** 권한 lease 끝(초). 발급 시점의 권한 확인이 유효한 마지막 시각. */
  l: number;
  /** 노트·게시물의 lifecycle 표지(마지막 복원 revision). 다른 문서는 없다. */
  e?: number;
};

const encoder = new TextEncoder();
const PURPOSE = "portal-collab-token-v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`${PURPOSE}\u0000${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signCollabToken(
  input: { key: string; userId: string; mode: CollabMode; lifecycle?: number },
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!secret) throw new Error("COLLAB_SECRET_MISSING");
  const nowSeconds = Math.floor(nowMs / 1000);
  const claims: CollabTokenClaims = {
    k: input.key,
    u: input.userId,
    m: input.mode,
    exp: nowSeconds + COLLAB_TOKEN_TTL_SECONDS,
    i: nowMs,
    l: nowSeconds + COLLAB_LEASE_SECONDS,
    ...(typeof input.lifecycle === "number" ? { e: input.lifecycle } : {}),
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function isClaims(value: unknown): value is CollabTokenClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.k === "string" &&
    claims.k.length > 0 &&
    typeof claims.u === "string" &&
    claims.u.length > 0 &&
    (claims.m === "read" || claims.m === "write") &&
    typeof claims.exp === "number" &&
    Number.isFinite(claims.exp) &&
    typeof claims.i === "number" &&
    Number.isFinite(claims.i) &&
    typeof claims.l === "number" &&
    Number.isFinite(claims.l) &&
    (claims.e === undefined || (Number.isSafeInteger(claims.e) && (claims.e as number) >= 0))
  );
}

/** 서명·만료·room key가 모두 맞을 때만 claims를 돌려준다. */
export async function verifyCollabToken(
  token: string,
  expectedKey: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<CollabTokenClaims | null> {
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signaturePart] = parts;
  const signature = fromBase64Url(signaturePart);
  if (!signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importKey(secret),
    signature as BufferSource,
    encoder.encode(payload),
  );
  if (!valid) return null;
  const payloadBytes = fromBase64Url(payload);
  if (!payloadBytes) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.k !== expectedKey) return null;
  if (claims.exp * 1000 <= nowMs) return null;
  return claims;
}
