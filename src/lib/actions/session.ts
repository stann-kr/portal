"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { PASSWORD_CHANGE_PATH } from "@/auth.config";
import { findActiveProfileByEmail } from "@/lib/active-profile";
import { loginCallbackUrl, loginErrorMessage } from "@/lib/login-messages";
import { isTemporaryPasswordHash } from "@/lib/password-storage";
import { PASSWORD_ATTEMPT_LIMITED_MESSAGE } from "@/lib/password-attempt-limit";
import { applySessionPersistence, clearSessionPersistence } from "@/lib/session-persistence-server";

/** class 사본이 둘 이상 load돼도 같은 판정을 하도록 Auth.js 오류의 type·code로 구분한다. */
function isLoginAttemptLimited(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { type, code } = error as { type?: unknown; code?: unknown };
  return type === "CredentialsSignin" && code === "rate_limited";
}

/**
 * 임시 비밀번호 계정은 로그인 직후 새 비밀번호 설정으로 바로 보낸다. 다른 주소를 거치면
 * middleware가 화면은 바꿔도 server action redirect의 주소가 주소 표시줄에 남는다.
 * 이동 주소는 인증에 성공했을 때만 쓰이므로 계정 상태를 드러내지 않는다.
 */
async function loginRedirectTarget(email: string, callbackUrl: unknown): Promise<string> {
  try {
    const profile = await findActiveProfileByEmail(email);
    if (isTemporaryPasswordHash(profile?.passwordHash)) return PASSWORD_CHANGE_PATH;
  } catch {
    // 조회 실패는 인증 경계(authorize)가 다시 판단한다.
  }
  return loginCallbackUrl(callbackUrl);
}

export type LoginState = { error?: string; email?: string };

/**
 * 로그인 실패를 redirect 대신 form 상태로 돌려 입력한 이메일과 원래 이동할 주소를 유지한다.
 * 성공하면 '로그인 유지' 선택을 session cookie에 반영한 뒤 Auth.js가 확인한 주소로 이동한다.
 */
export async function loginWithCredentials(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "이메일과 비밀번호를 입력해 주세요.", email };

  let destination: string;
  try {
    destination = await signIn("credentials", {
      email,
      password,
      redirect: false,
      redirectTo: await loginRedirectTarget(email, formData.get("callbackUrl")),
    });
  } catch (error) {
    if (isLoginAttemptLimited(error)) {
      return { error: PASSWORD_ATTEMPT_LIMITED_MESSAGE, email };
    }
    if (error instanceof AuthError) {
      return { error: loginErrorMessage(error.type) ?? undefined, email };
    }
    throw error;
  }
  await applySessionPersistence(formData.get("remember") === "on");
  redirect(destination);
}

/** 루트를 거치면 그 redirect가 주소 표시줄에 남으므로 로그인 화면으로 바로 보낸다. */
export async function logoutCurrentUser(): Promise<void> {
  await clearSessionPersistence();
  await signOut({ redirectTo: "/login" });
}
