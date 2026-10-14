import * as bcrypt from "bcryptjs";

/**
 * profiles.password_hash 저장 형식.
 * 관리자가 발급한 임시 비밀번호는 bcrypt hash 앞에 표시를 붙여 저장하고, 학생이 새 비밀번호를
 * 정하면 표시 없는 hash로 바뀐다. "다음 로그인에서 변경 필요" 상태를 hash와 같은 값에 두어
 * schema 변경 없이 한 번의 쓰기로 함께 바뀌게 한다. bcrypt hash는 `$`로 시작하므로 겹치지 않는다.
 */
const TEMPORARY_PASSWORD_HASH_PREFIX = "temporary:";

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

/** 저장 형식과 관계없이 입력한 비밀번호가 저장된 hash와 맞는지 확인한다. */
export async function verifyStoredPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
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
