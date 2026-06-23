import { createHmac, timingSafeEqual } from "node:crypto";

function getCalendarFeedSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for calendar feed tokens");
  }
  return secret;
}

function signStudentId(studentId: string) {
  return createHmac("sha256", getCalendarFeedSecret())
    .update(`calendar-feed:${studentId}`)
    .digest("hex");
}

export function createCalendarFeedToken(studentId: string) {
  return `v1.${studentId}.${signStudentId(studentId)}`;
}

export function verifyCalendarFeedToken(studentId: string, token: string | null) {
  if (!token) return false;

  const [version, tokenStudentId, signature] = token.split(".");
  if (version !== "v1" || tokenStudentId !== studentId || !signature) {
    return false;
  }

  const expected = signStudentId(studentId);
  const actualBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(actualBuf, expectedBuf);
}
