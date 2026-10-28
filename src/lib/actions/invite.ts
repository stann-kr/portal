"use server";

import { and, eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { createDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { parseInviteToken } from "@/lib/invite-token";
import { isPasswordAttemptAllowed, PASSWORD_ATTEMPT_LIMITED_MESSAGE } from "@/lib/password-attempt-limit";
import { newPasswordPolicyError } from "@/lib/password-policy";
import { verifyInviteSecret } from "@/lib/password-storage";

export type InviteStatus =
  | { status: "valid"; displayName: string | null; email: string }
  | { status: "expired" | "invalid" }
  | { status: "limited"; error: string };

export type CompleteInviteField = "newPassword" | "confirmPassword";

export type CompleteInviteState = {
  error?: string;
  field?: CompleteInviteField;
  /** 링크를 더 쓸 수 없어 입력 form을 닫아야 한다. */
  linkUnusable?: "expired" | "invalid";
  success?: boolean;
  /** 비밀번호는 저장됐지만 이 기기의 로그인을 발급하지 못했다. */
  signInRequired?: boolean;
};

async function loadInvite(token: unknown) {
  const parsed = parseInviteToken(token);
  if (!parsed) return null;
  const [account] = await createDb()
    .select({
      id: profiles.id,
      email: profiles.email,
      displayName: profiles.displayName,
      role: profiles.role,
      passwordHash: profiles.passwordHash,
    })
    .from(profiles)
    .where(eq(profiles.id, parsed.studentId))
    .limit(1);
  if (!account || account.role !== "student") return null;
  const result = await verifyInviteSecret(parsed.secret, account.passwordHash, new Date());
  return { account, result };
}

/** 가입 링크가 아직 쓸 수 있는지 확인한다. 로그인 없이 호출되므로 시도 한도를 함께 적용한다. */
export async function getInviteStatus(token: string): Promise<InviteStatus> {
  if (!(await isPasswordAttemptAllowed("invite", headers))) {
    return { status: "limited", error: PASSWORD_ATTEMPT_LIMITED_MESSAGE };
  }
  const invite = await loadInvite(token);
  if (!invite || invite.result === "invalid") return { status: "invalid" };
  if (invite.result === "expired") return { status: "expired" };
  return { status: "valid", displayName: invite.account.displayName, email: invite.account.email };
}

/**
 * 가입 링크에서 학생이 직접 비밀번호를 정한다. 링크 secret이 그대로일 때만 저장해 한 번만 쓰이게 하고,
 * 성공하면 새 비밀번호로 이 기기의 로그인을 발급한다.
 */
export async function completeInvite(
  _previous: CompleteInviteState,
  formData: FormData,
): Promise<CompleteInviteState> {
  const token = formData.get("token");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const policyError = newPasswordPolicyError(newPassword);
  if (policyError) return { error: policyError, field: "newPassword" };
  if (newPassword !== confirmPassword) {
    return { error: "비밀번호 확인이 일치하지 않습니다.", field: "confirmPassword" };
  }
  if (!(await isPasswordAttemptAllowed("invite", headers))) {
    return { error: PASSWORD_ATTEMPT_LIMITED_MESSAGE };
  }

  const invite = await loadInvite(token);
  if (!invite || invite.result !== "valid") {
    return invite?.result === "expired"
      ? { error: "가입 링크가 만료됐습니다. Stann에게 새 링크를 요청해 주세요.", linkUnusable: "expired" }
      : { error: "가입 링크가 올바르지 않거나 이미 사용됐습니다. Stann에게 새 링크를 요청해 주세요.", linkUnusable: "invalid" };
  }

  const updated = await createDb()
    .update(profiles)
    .set({ passwordHash: await bcrypt.hash(newPassword, 10) })
    .where(and(eq(profiles.id, invite.account.id), eq(profiles.passwordHash, invite.account.passwordHash!)))
    .returning({ id: profiles.id });
  if (updated.length === 0) {
    return { error: "가입 링크가 이미 사용됐습니다. 정한 비밀번호로 로그인해 주세요.", linkUnusable: "invalid" };
  }

  try {
    await signIn("credentials", { email: invite.account.email, password: newPassword, redirect: false });
  } catch {
    return { success: true, signInRequired: true };
  }
  return { success: true };
}
