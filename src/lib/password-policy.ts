export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt는 72 byte 뒤를 비교하지 않으므로 그보다 긴 비밀번호는 받지 않는다. */
export const PASSWORD_MAX_BYTES = 72;

/** 새 비밀번호 정책 위반 안내. 통과하면 null. */
export function newPasswordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }
  if (new TextEncoder().encode(password).byteLength > PASSWORD_MAX_BYTES) {
    return "비밀번호가 너무 깁니다. 더 짧게 입력해 주세요.";
  }
  return null;
}
