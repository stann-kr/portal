"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { loginCallbackUrl, loginErrorMessage } from "@/lib/login-messages";

export type LoginState = { error?: string; email?: string };

/**
 * 로그인 실패를 redirect 대신 form 상태로 돌려 입력한 이메일과 원래 이동할 주소를 유지한다.
 * 성공 시 NextAuth redirect는 그대로 다시 던져 router가 처리한다.
 */
export async function loginWithCredentials(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "이메일과 비밀번호를 입력해 주세요.", email };

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: loginCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: loginErrorMessage(error.type) ?? undefined, email };
    }
    throw error;
  }
  return { email };
}

export async function logoutCurrentUser(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
