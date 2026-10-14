/**
 * 가입 링크 token은 `<학생 id>.<secret>`이다. 링크는 `/invite#<token>` 형태라 token이 서버 요청
 * 주소나 접속 기록에 남지 않고, 화면이 읽어 server action 본문으로만 보낸다.
 */
export const INVITE_PATH = "/invite";
/** 가입 링크는 발급 뒤 7일 동안 한 번 쓸 수 있다. */
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function buildInvitePath(studentId: string, secret: string): string {
  return `${INVITE_PATH}#${studentId}.${secret}`;
}

export function parseInviteToken(token: unknown): { studentId: string; secret: string } | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const separator = token.lastIndexOf(".");
  if (separator < 1 || separator === token.length - 1) return null;
  return { studentId: token.slice(0, separator), secret: token.slice(separator + 1) };
}
