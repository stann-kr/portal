"use server";

import { and, eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { createDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { requireSignedInSession } from "@/lib/auth-guard";
import { newPasswordPolicyError } from "@/lib/password-policy";
import { verifyStoredPassword } from "@/lib/password-storage";
import { headers } from "next/headers";
import { isPasswordAttemptAllowed, PASSWORD_ATTEMPT_LIMITED_MESSAGE } from "@/lib/password-attempt-limit";

export type ChangePasswordField = "currentPassword" | "newPassword" | "confirmPassword";

export type ChangePasswordState = {
  error?: string;
  field?: ChangePasswordField;
  success?: boolean;
  /** 새 비밀번호는 저장됐지만 현재 기기의 로그인을 다시 발급하지 못했다. */
  signInRequired?: boolean;
};

/**
 * 로그인한 사용자 본인의 비밀번호를 현재 비밀번호 확인 뒤 바꾼다.
 * 관리자가 발급한 임시 비밀번호로 로그인한 session도 이 action으로만 새 비밀번호를 정한다.
 * 저장은 읽은 hash가 그대로일 때만 수행해 동시 변경을 덮지 않는다. 성공하면 새 비밀번호로
 * 현재 기기의 session을 다시 발급하고, 이전 비밀번호 지문에 묶인 다른 기기의 session은
 * 다음 요청에서 거부된다.
 */
export async function changeOwnPassword(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await requireSignedInSession();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const currentLabel = session.user.passwordChangeRequired ? "임시 비밀번호" : "현재 비밀번호";

  if (!currentPassword) {
    return { error: `${currentLabel}를 입력해 주세요.`, field: "currentPassword" };
  }
  const policyError = newPasswordPolicyError(newPassword);
  if (policyError) return { error: policyError, field: "newPassword" };
  if (newPassword !== confirmPassword) {
    return { error: "새 비밀번호 확인이 일치하지 않습니다.", field: "confirmPassword" };
  }
  if (newPassword === currentPassword) {
    return { error: `${currentLabel}와 다른 비밀번호를 입력해 주세요.`, field: "newPassword" };
  }

  if (!(await isPasswordAttemptAllowed("password-change", headers))) {
    return { error: PASSWORD_ATTEMPT_LIMITED_MESSAGE };
  }

  const db = createDb();
  const [account] = await db
    .select({ email: profiles.email, passwordHash: profiles.passwordHash })
    .from(profiles)
    .where(eq(profiles.id, session.user.id))
    .limit(1);
  if (!account?.passwordHash || !(await verifyStoredPassword(currentPassword, account.passwordHash))) {
    return { error: `${currentLabel}가 올바르지 않습니다.`, field: "currentPassword" };
  }

  const nextPasswordHash = await bcrypt.hash(newPassword, 10);
  const updated = await db
    .update(profiles)
    .set({ passwordHash: nextPasswordHash })
    .where(and(eq(profiles.id, session.user.id), eq(profiles.passwordHash, account.passwordHash)))
    .returning({ id: profiles.id });
  if (updated.length === 0) {
    return { error: "다른 곳에서 비밀번호가 먼저 바뀌었습니다. 새 비밀번호로 다시 로그인한 뒤 시도해 주세요." };
  }

  try {
    await signIn("credentials", { email: account.email, password: newPassword, redirect: false });
  } catch {
    return { success: true, signInRequired: true };
  }
  return { success: true };
}
