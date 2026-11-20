/**
 * 화면에 보이지 않는 사용자 이름 칸. 비밀번호 칸만 있는 form(가입·비밀번호 변경)에서 iCloud 키체인·암호 관리자가
 * 새 비밀번호를 어느 계정(로그인 이메일)으로 저장할지 알게 한다. 서버 action은 이 값을 읽지 않는다.
 */
export function PasswordManagerUsername({ value }: { value: string | null | undefined }) {
  return value ? <input type="email" name="username" autoComplete="username" value={value} readOnly hidden /> : null;
}
