import type { ExternalCalendarProvider } from "@/db/schema";

/**
 * 양방향 동기화 연결 자격 증명의 AES-GCM 저장 형식.
 * key는 iCal 구독과 같은 EXTERNAL_CALENDAR_ENCRYPTION_KEY를 쓰고, AAD로 연결 id와 provider를 묶어
 * 다른 행·provider로 옮긴 ciphertext를 거부한다. 원문·오류 본문은 로그나 응답에 넣지 않는다.
 */

export type GoogleConnectionCredentials = {
  refreshToken: string;
  accessToken?: string;
  /** epoch ms */
  accessTokenExpiresAt?: number;
};

export type ICloudConnectionCredentials = {
  appleId: string;
  appPassword: string;
  calendarHomeUrl: string;
};

export type ConnectionCredentials<P extends ExternalCalendarProvider = ExternalCalendarProvider> =
  P extends "GOOGLE" ? GoogleConnectionCredentials : ICloudConnectionCredentials;

export class CalendarCredentialError extends Error {}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new CalendarCredentialError("Stored calendar credentials cannot be read");
  }
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new CalendarCredentialError("Stored calendar credentials cannot be read");
  }
}

function bytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

export function connectionCredentialsAad(connectionId: string, provider: ExternalCalendarProvider): Uint8Array {
  return new TextEncoder().encode(`calendar-connection:v1:${connectionId}:${provider}`);
}

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== 32) throw new CalendarCredentialError("Calendar encryption key is unavailable");
}

function assertCredentials(provider: ExternalCalendarProvider, value: unknown): void {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (provider === "GOOGLE") {
    if (typeof record.refreshToken !== "string" || !record.refreshToken) {
      throw new CalendarCredentialError("Stored calendar credentials cannot be read");
    }
    if (record.accessToken !== undefined && typeof record.accessToken !== "string") {
      throw new CalendarCredentialError("Stored calendar credentials cannot be read");
    }
    if (record.accessTokenExpiresAt !== undefined && !Number.isFinite(record.accessTokenExpiresAt)) {
      throw new CalendarCredentialError("Stored calendar credentials cannot be read");
    }
    return;
  }
  if (
    typeof record.appleId !== "string" || !record.appleId ||
    typeof record.appPassword !== "string" || !record.appPassword ||
    typeof record.calendarHomeUrl !== "string" || !record.calendarHomeUrl
  ) {
    throw new CalendarCredentialError("Stored calendar credentials cannot be read");
  }
}

export async function encryptConnectionCredentials<P extends ExternalCalendarProvider>(input: {
  connectionId: string;
  provider: P;
  credentials: ConnectionCredentials<P>;
  key: Uint8Array;
}): Promise<{ encryptedCredentials: string; credentialsIv: string }> {
  assertKey(input.key);
  assertCredentials(input.provider, input.credentials);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", bytes(input.key), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: bytes(connectionCredentialsAad(input.connectionId, input.provider)) },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(input.credentials)),
  );
  return { encryptedCredentials: base64UrlEncode(new Uint8Array(encrypted)), credentialsIv: base64UrlEncode(iv) };
}

export async function decryptConnectionCredentials<P extends ExternalCalendarProvider>(input: {
  connectionId: string;
  provider: P;
  encryptedCredentials: string;
  credentialsIv: string;
  key: Uint8Array;
}): Promise<ConnectionCredentials<P>> {
  assertKey(input.key);
  let parsed: unknown;
  try {
    const iv = base64UrlDecode(input.credentialsIv);
    const ciphertext = base64UrlDecode(input.encryptedCredentials);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new CalendarCredentialError("invalid");
    const cryptoKey = await crypto.subtle.importKey("raw", bytes(input.key), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(iv), additionalData: bytes(connectionCredentialsAad(input.connectionId, input.provider)) },
      cryptoKey,
      bytes(ciphertext),
    );
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new CalendarCredentialError("Stored calendar credentials cannot be read");
  }
  assertCredentials(input.provider, parsed);
  return parsed as ConnectionCredentials<P>;
}
