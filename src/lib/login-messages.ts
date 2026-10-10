/** NextAuth 오류 type을 로그인 화면 안내로 바꾼다. 알 수 없는 값은 화면에 그대로 반사하지 않는다. */
export function loginErrorMessage(type: string | null | undefined): string | null {
  if (!type) return null;
  const messages: Record<string, string> = {
    CredentialsSignin: "이메일 또는 비밀번호가 올바르지 않습니다.",
    Configuration: "서버 설정 오류가 발생했습니다. 관리자에게 문의하세요.",
    AccessDenied: "접근 권한이 없습니다.",
    Verification: "인증 링크가 만료되었습니다.",
  };
  return messages[type] ?? "로그인 중 오류가 발생했습니다. 다시 시도해 주세요.";
}

/** 로그인 뒤 이동할 주소. 같은 origin 확인은 NextAuth redirect callback이 다시 수행한다. */
export function loginCallbackUrl(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048 ? value : "/dashboard";
}
