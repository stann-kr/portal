import * as bcrypt from "bcryptjs";

/**
 * profiles.password_hash 저장 형식.
 * - 일반: bcrypt hash
 * - `temporary:<bcrypt>`: 관리자가 발급한 임시 비밀번호. 로그인은 되지만 새 비밀번호를 정해야 한다.
 * - `invite:<만료 epoch 초>:<bcrypt>`: 아직 가입하지 않은 계정의 가입 링크 secret. 로그인에는 쓸 수 없다.
 * 학생이 새 비밀번호를 정하면 표시 없는 hash로 바뀐다. 상태를 hash와 같은 값에 두어 schema 변경
 * 없이 한 번의 쓰기로 함께 바뀌게 한다. bcrypt hash는 `$`로 시작하므로 표시와 겹치지 않는다.
 */
const TEMPORARY_PASSWORD_HASH_PREFIX = "temporary:";
const INVITE_HASH_PREFIX = "invite:";

/** 32자(혼동되는 l·o·0·1 제외)라 byte % 32에 편향이 없다. */
const TEMPORARY_PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const TEMPORARY_PASSWORD_GROUPS = 3;
const TEMPORARY_PASSWORD_GROUP_LENGTH = 4;

export function temporaryPasswordHash(bcryptHash: string): string {
  return `${TEMPORARY_PASSWORD_HASH_PREFIX}${bcryptHash}`;
}

export function isTemporaryPasswordHash(storedHash: string | null | undefined): boolean {
  return typeof storedHash === "string" && storedHash.startsWith(TEMPORARY_PASSWORD_HASH_PREFIX);
}

export function inviteHash(bcryptHash: string, expiresAt: Date): string {
  return `${INVITE_HASH_PREFIX}${Math.floor(expiresAt.getTime() / 1000)}:${bcryptHash}`;
}

export function parseInviteHash(
  storedHash: string | null | undefined,
): { expiresAt: Date; bcryptHash: string } | null {
  if (typeof storedHash !== "string" || !storedHash.startsWith(INVITE_HASH_PREFIX)) return null;
  const rest = storedHash.slice(INVITE_HASH_PREFIX.length);
  const separator = rest.indexOf(":");
  const seconds = Number(rest.slice(0, separator));
  if (separator < 1 || !Number.isSafeInteger(seconds)) return null;
  return { expiresAt: new Date(seconds * 1000), bcryptHash: rest.slice(separator + 1) };
}

export type StoredCredentialState =
  | { kind: "active" }
  | { kind: "temporary" }
  | { kind: "invite"; expiresAt: Date };

export function storedCredentialState(storedHash: string | null | undefined): StoredCredentialState {
  const invite = parseInviteHash(storedHash);
  if (invite) return { kind: "invite", expiresAt: invite.expiresAt };
  return isTemporaryPasswordHash(storedHash) ? { kind: "temporary" } : { kind: "active" };
}

/** 가입 링크 secret 확인. secret이 틀리면 만료 여부를 드러내지 않는다. */
export async function verifyInviteSecret(
  secret: string,
  storedHash: string | null | undefined,
  now: Date,
): Promise<"valid" | "expired" | "invalid"> {
  const invite = parseInviteHash(storedHash);
  if (!invite || !secret || !(await bcrypt.compare(secret, invite.bcryptHash))) return "invalid";
  return invite.expiresAt.getTime() > now.getTime() ? "valid" : "expired";
}

/** 가입 링크에 넣는 256-bit secret. */
export function generateInviteSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** 저장 형식과 관계없이 입력한 비밀번호가 저장된 hash와 맞는지 확인한다. 가입 링크 secret은 로그인에 쓸 수 없다. */
export async function verifyStoredPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash || parseInviteHash(storedHash)) return false;
  const bcryptHash = isTemporaryPasswordHash(storedHash)
    ? storedHash.slice(TEMPORARY_PASSWORD_HASH_PREFIX.length)
    : storedHash;
  return bcrypt.compare(password, bcryptHash);
}

/** 학생에게 말이나 메시지로 전달하기 쉬운 `xxxx-xxxx-xxxx` 형식의 60-bit 임시 비밀번호. */
export function generateTemporaryPassword(): string {
  const length = TEMPORARY_PASSWORD_GROUPS * TEMPORARY_PASSWORD_GROUP_LENGTH;
  const characters = Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (byte) => TEMPORARY_PASSWORD_ALPHABET[byte % TEMPORARY_PASSWORD_ALPHABET.length],
  );
  return Array.from({ length: TEMPORARY_PASSWORD_GROUPS }, (_, group) =>
    characters
      .slice(group * TEMPORARY_PASSWORD_GROUP_LENGTH, (group + 1) * TEMPORARY_PASSWORD_GROUP_LENGTH)
      .join(""),
  ).join("-");
}
