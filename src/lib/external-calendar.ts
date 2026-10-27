import ICAL from "ical.js";
import type { ExternalCalendarProvider } from "@/db/schema";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export const EXTERNAL_CALENDAR_MAX_BYTES = 1024 * 1024;
export const EXTERNAL_CALENDAR_MAX_URL_LENGTH = 4_096;
export const EXTERNAL_CALENDAR_TIMEOUT_MS = 5_000;
export const EXTERNAL_CALENDAR_WINDOW_PAST_DAYS = 90;
export const EXTERNAL_CALENDAR_WINDOW_FUTURE_DAYS = 365;
export const EXTERNAL_CALENDAR_MAX_WINDOW_DAYS = 1_095;
export const EXTERNAL_CALENDAR_MAX_EVENTS = 500;
export const EXTERNAL_CALENDAR_MAX_OCCURRENCES = 2_000;

export type ExternalCalendarConnectionSummary = {
  connected: boolean;
  provider?: ExternalCalendarProvider;
  label?: string;
};

export class ExternalCalendarError extends Error {}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const unpadded = value.replace(/=+$/u, "");
  const paddingLength = value.length - unpadded.length;
  if (
    !/^[A-Za-z0-9+/_-]+$/u.test(unpadded) ||
    paddingLength > 2 ||
    unpadded.length % 4 === 1
  ) {
    throw new ExternalCalendarError("Invalid encrypted calendar payload");
  }
  const padded = unpadded.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (unpadded.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ExternalCalendarError("Invalid encrypted calendar payload");
  }
}

export function normalizeExternalCalendarUrl(value: string): {
  provider: ExternalCalendarProvider;
  url: string;
  label: string;
} {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > EXTERNAL_CALENDAR_MAX_URL_LENGTH) {
    throw new ExternalCalendarError("공개 iCal URL 형식이 올바르지 않습니다.");
  }
  const normalized = /^webcal:/iu.test(trimmed) ? `https:${trimmed.slice("webcal:".length)}` : trimmed;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ExternalCalendarError("공개 iCal URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new ExternalCalendarError("보안된 공개 iCal HTTPS URL만 연결할 수 있습니다.");
  }

  if (url.hostname === "calendar.google.com") {
    // 공개 주소와 비공개(Secret) 주소 모두 읽기 전용으로 받는다. 비공개 주소는 그 자체가 열쇠라
    // 다른 URL처럼 AES-GCM으로만 저장하고 화면·로그에 원문을 돌려주지 않는다.
    const match = /^\/calendar\/ical\/([^/]+)\/(public|private-[A-Za-z0-9]+)\/basic\.ics$/u.exec(url.pathname);
    if (!match) {
      throw new ExternalCalendarError("Google iCal 주소(공개 또는 비공개 basic.ics)만 사용할 수 있습니다.");
    }
    const isPrivate = match[2] !== "public";
    return {
      provider: "GOOGLE",
      url: url.toString(),
      label: isPrivate ? "Google 비공개 레슨 캘린더" : "Google 공개 레슨 캘린더",
    };
  }

  if (/^p\d+-caldav\.icloud\.com$/iu.test(url.hostname) && /^\/published\/2\/[^/]+$/u.test(url.pathname)) {
    return { provider: "ICLOUD", url: url.toString(), label: "iCloud 공개 레슨 캘린더" };
  }
  throw new ExternalCalendarError("Google 또는 iCloud의 전용 공개 레슨 캘린더 주소만 사용할 수 있습니다.");
}

function additionalData(studentId: string, provider: ExternalCalendarProvider): Uint8Array {
  return new TextEncoder().encode(`external-calendar-url:v1:${studentId}:${provider}`);
}

function asWebCryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function assertExternalCalendarKey(key: Uint8Array): void {
  if (key.byteLength !== 32) {
    throw new ExternalCalendarError("External calendar encryption key is unavailable");
  }
}

export function decodeExternalCalendarKey(encodedKey: string): Uint8Array {
  const key = base64UrlDecode(encodedKey);
  assertExternalCalendarKey(key);
  return key;
}

export async function encryptExternalCalendarUrl(input: {
  url: string;
  studentId: string;
  provider: ExternalCalendarProvider;
  key: Uint8Array;
}): Promise<{ encryptedUrl: string; urlIv: string }> {
  assertExternalCalendarKey(input.key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", asWebCryptoBytes(input.key), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: asWebCryptoBytes(additionalData(input.studentId, input.provider)) },
    cryptoKey,
    new TextEncoder().encode(input.url),
  );
  return { encryptedUrl: base64UrlEncode(new Uint8Array(encrypted)), urlIv: base64UrlEncode(iv) };
}

export async function decryptExternalCalendarUrl(input: {
  encryptedUrl: string;
  urlIv: string;
  studentId: string;
  provider: ExternalCalendarProvider;
  key: Uint8Array;
}): Promise<string> {
  assertExternalCalendarKey(input.key);
  const cryptoKey = await crypto.subtle.importKey("raw", asWebCryptoBytes(input.key), "AES-GCM", false, ["decrypt"]);
  try {
    const iv = base64UrlDecode(input.urlIv);
    const encryptedUrl = base64UrlDecode(input.encryptedUrl);
    if (iv.byteLength !== 12 || encryptedUrl.byteLength < 16) {
      throw new ExternalCalendarError("Stored external calendar cannot be read");
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asWebCryptoBytes(iv), additionalData: asWebCryptoBytes(additionalData(input.studentId, input.provider)) },
      cryptoKey,
      asWebCryptoBytes(encryptedUrl),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new ExternalCalendarError("Stored external calendar cannot be read");
  }
}

export async function fetchExternalCalendarIcs(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = EXTERNAL_CALENDAR_TIMEOUT_MS,
): Promise<string> {
  normalizeExternalCalendarUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { redirect: "manual", signal: controller.signal });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || response.status >= 300 || !response.body || response.type === "opaqueredirect") throw new ExternalCalendarError("External calendar is unavailable");
    if (contentType && !/^(text\/calendar|text\/plain|application\/octet-stream)(?:;|$)/u.test(contentType)) {
      throw new ExternalCalendarError("External calendar is invalid");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > EXTERNAL_CALENDAR_MAX_BYTES) {
        await reader.cancel();
        throw new ExternalCalendarError("External calendar is too large");
      }
      chunks.push(next.value);
    }
    const result = new TextDecoder().decode(concatChunks(chunks, length));
    if (!/BEGIN:VCALENDAR[\r\n]/iu.test(result) || !/END:VCALENDAR/iu.test(result)) {
      throw new ExternalCalendarError("External calendar is invalid");
    }
    return result;
  } catch (error) {
    if (error instanceof ExternalCalendarError) throw error;
    throw new ExternalCalendarError("External calendar is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function concatChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function calendarWindow(referenceTime: Date): { start: Date; end: Date } {
  const start = new Date(referenceTime);
  start.setUTCDate(start.getUTCDate() - EXTERNAL_CALENDAR_WINDOW_PAST_DAYS);
  const end = new Date(referenceTime);
  end.setUTCDate(end.getUTCDate() + EXTERNAL_CALENDAR_WINDOW_FUTURE_DAYS);
  return { start, end };
}

function resolveCalendarWindow(input: {
  referenceTime?: Date;
  window?: { start: Date; end: Date };
}): { start: Date; end: Date } {
  if (!input.window) return calendarWindow(input.referenceTime ?? new Date());
  const { start, end } = input.window;
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs > endMs ||
    endMs - startMs > EXTERNAL_CALENDAR_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1_000
  ) {
    throw new ExternalCalendarError("External calendar window is invalid");
  }
  return { start: new Date(startMs), end: new Date(endMs) };
}

function sanitizeSummary(value: unknown): string {
  return String(value ?? "레슨").replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, 200) || "레슨";
}

async function stableExternalEventId(subscriptionId: string, uid: string, recurrenceId: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${subscriptionId}:${uid}:${recurrenceId}`));
  return `external-${base64UrlEncode(new Uint8Array(bytes)).slice(0, 32)}`;
}

/** iCal을 bounded, read-only UnifiedItem으로 변환한다. description·attendees·UID는 반환하지 않는다. */
export async function parseExternalCalendarItems(input: {
  ics: string;
  subscriptionId: string;
  studentId: string;
  provider: ExternalCalendarProvider;
  spaceLabel: string;
  referenceTime?: Date;
  window?: { start: Date; end: Date };
}): Promise<UnifiedItem[]> {
  const component = new ICAL.Component(ICAL.parse(input.ics));
  if (component.name !== "vcalendar") throw new ExternalCalendarError("External calendar is invalid");
  const window = resolveCalendarWindow(input);
  const result: UnifiedItem[] = [];
  const source = {
    kind: input.provider === "GOOGLE" ? "GOOGLE_CALENDAR" as const : "ICLOUD_CALENDAR" as const,
    entity: "EXTERNAL_CALENDAR_EVENT" as const,
    label: input.provider === "GOOGLE" ? "Google Calendar" : "iCloud Calendar",
  };
  const eventComponents = component.getAllSubcomponents("vevent");
  if (eventComponents.length > EXTERNAL_CALENDAR_MAX_EVENTS) throw new ExternalCalendarError("External calendar has too many events");
  const eventEntries = eventComponents.map((eventComponent) => ({
    component: eventComponent,
    event: new ICAL.Event(eventComponent),
  }));
  let expanded = 0;
  for (const entry of eventEntries) {
    if (entry.event.isRecurrenceException() || entry.component.getFirstPropertyValue("status") === "CANCELLED") continue;
    const uid = entry.event.uid;
    if (!uid) continue;
    const exceptions = eventEntries
      .filter((candidate) => candidate.event.isRecurrenceException() && candidate.event.uid === uid)
      .map((candidate) => candidate.component);
    const event = new ICAL.Event(entry.component, { exceptions });
    const occurrences = event.isRecurring() ? event.iterator() : null;
    const candidates: ICAL.Time[] = [];
    if (occurrences) {
      while (true) {
        if (expanded >= EXTERNAL_CALENDAR_MAX_OCCURRENCES) {
          throw new ExternalCalendarError("External calendar has too many recurrences");
        }
        const next = occurrences.next();
        if (!next) break;
        expanded += 1;
        if (next.toJSDate() > window.end) break;
        candidates.push(next);
      }
    } else {
      candidates.push(event.startDate);
    }
    for (const occurrence of candidates) {
      const details = event.getOccurrenceDetails(occurrence);
      if (details.item.component.getFirstPropertyValue("status") === "CANCELLED") continue;
      const start = details.startDate.toJSDate();
      if (start < window.start || start > window.end) continue;
      const recurrenceIdentity = details.recurrenceId.toString();
      const allDay = details.startDate.isDate;
      result.push({
        id: await stableExternalEventId(input.subscriptionId, uid, recurrenceIdentity),
        type: "EVENT",
        subType: "LESSON",
        title: sanitizeSummary(details.item.summary),
        date: start,
        endDate: details.endDate ? details.endDate.toJSDate() : null,
        metadata: {
          allDay,
          external: true,
          ...(allDay
            ? {
                allDayStartDate: details.startDate.toString(),
                allDayEndDate: details.endDate.toString(),
              }
            : {}),
        },
        space: { studentId: input.studentId, label: input.spaceLabel },
        source,
      });
      if (result.length >= EXTERNAL_CALENDAR_MAX_OCCURRENCES) {
        throw new ExternalCalendarError("External calendar has too many recurrences");
      }
    }
  }
  return result.sort((left, right) => left.date.getTime() - right.date.getTime());
}

/** 연결 전 URL allowlist, 네트워크 응답, iCal 구문을 한 번에 검증한다. 빈 공개 캘린더도 유효하다. */
export async function validateExternalCalendarConnection(input: {
  provider: ExternalCalendarProvider;
  url: string;
  studentId: string;
  spaceLabel: string;
  fetchImpl?: typeof fetch;
}): Promise<{ provider: ExternalCalendarProvider; url: string; label: string }> {
  const normalized = normalizeExternalCalendarUrl(input.url);
  if (normalized.provider !== input.provider) throw new ExternalCalendarError("External calendar provider mismatch");
  const ics = await fetchExternalCalendarIcs(normalized.url, input.fetchImpl);
  await parseExternalCalendarItems({
    ics,
    subscriptionId: "connection-check",
    studentId: input.studentId,
    provider: normalized.provider,
    spaceLabel: input.spaceLabel,
  });
  return normalized;
}
