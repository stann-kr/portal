import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const CALENDAR_FEED_V2_TOKEN_BYTES = 32;
const CALENDAR_FEED_V2_PATTERN = /^v2\.[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function getCalendarFeedSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for legacy calendar feed tokens");
  }
  return secret;
}

function signStudentId(studentId: string) {
  return createHmac("sha256", getCalendarFeedSecret())
    .update(`calendar-feed:${studentId}`)
    .digest("hex");
}

function safeEqualUtf8(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/** 신규 feed에만 사용하는 owner ID 비노출 opaque token. */
export function createOpaqueCalendarFeedToken(
  entropy: Uint8Array = randomBytes(CALENDAR_FEED_V2_TOKEN_BYTES),
): string {
  if (entropy.byteLength !== CALENDAR_FEED_V2_TOKEN_BYTES) {
    throw new Error("Calendar feed token entropy must be exactly 32 bytes");
  }
  return `v2.${Buffer.from(entropy).toString("base64url")}`;
}

/** DB에는 raw token 대신 이 digest만 저장한다. */
export function digestCalendarFeedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** token-only v2 route가 형식을 검증한 뒤 DB lookup에 쓸 digest를 만든다. */
export function parseOpaqueCalendarFeedTokenDigest(
  token: string | null,
): string | null {
  return token && CALENDAR_FEED_V2_PATTERN.test(token)
    ? digestCalendarFeedToken(token)
    : null;
}

export type CalendarFeedDigestLookup = (
  ownerId: string,
) => Promise<string | null>;

type CalendarFeedOwner = { id: string; role: string } | null;
type CalendarFeedViewer = { id: string; role: string } | null;

/** owner profile이 active student인 요청만 session/token 결과를 권한으로 승격한다. */
export function canAccessCalendarFeed(
  owner: CalendarFeedOwner,
  viewer: CalendarFeedViewer,
  hasValidToken: boolean,
): boolean {
  if (!owner || owner.role !== "student") return false;
  return (
    hasValidToken ||
    viewer?.role === "admin" ||
    viewer?.id === owner.id
  );
}

export type CalendarFeedDigestWriter = (
  ownerId: string,
  tokenDigest: string,
) => Promise<void>;

/** raw token은 호출자에게 한 번만 반환하고 writer에는 digest만 전달한다. */
export async function issueCalendarFeedToken(
  ownerId: string,
  writeDigest: CalendarFeedDigestWriter,
  entropy?: Uint8Array,
): Promise<string> {
  const token = createOpaqueCalendarFeedToken(entropy);
  await writeDigest(ownerId, digestCalendarFeedToken(token));
  return token;
}

export async function verifyCalendarFeedToken(
  ownerId: string,
  token: string | null,
  lookupDigest: CalendarFeedDigestLookup,
): Promise<boolean> {
  if (!token) return false;

  if (CALENDAR_FEED_V2_PATTERN.test(token)) {
    const storedDigest = await lookupDigest(ownerId);
    if (!storedDigest || !SHA256_HEX_PATTERN.test(storedDigest)) return false;
    return safeEqualUtf8(digestCalendarFeedToken(token), storedDigest);
  }

  if (!verifyLegacyCalendarFeedToken(ownerId, token)) return false;

  // owner가 v2를 한 번이라도 발급하면 기존 deterministic v1 URL은 폐기한다.
  return (await lookupDigest(ownerId)) === null;
}

/**
 * migration window의 기존 v1 URL 검증 전용. 신규 발급에는 사용하지 않는다.
 * route는 이 함수 호출 전에도 반드시 owner profile 존재를 확인해야 한다.
 */
export function verifyLegacyCalendarFeedToken(
  studentId: string,
  token: string,
): boolean {
  const [version, tokenStudentId, signature, ...rest] = token.split(".");
  if (
    version !== "v1" ||
    tokenStudentId !== studentId ||
    !signature ||
    rest.length > 0
  ) {
    return false;
  }
  return safeEqualUtf8(signature, signStudentId(studentId));
}

/** 테스트·legacy compatibility 확인 전용이며 신규 runtime에서 호출하지 않는다. */
export function createLegacyCalendarFeedToken(studentId: string): string {
  return `v1.${studentId}.${signStudentId(studentId)}`;
}
