/**
 * @file src/lib/actions/students.ts
 * @description 학생 계정 관련 서버 액션.
 * Admin 전용: 학생 생성(초대), 목록 조회, 삭제.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { count, eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import { findStudentTarget, requireAdmin } from "@/lib/auth-guard";
import {
  queryStudentRosterStats,
  type StudentRosterStat,
} from "@/lib/student-roster";

export type { StudentRosterStat } from "@/lib/student-roster";

// ───────────────────────────────────────────────
// 학생 목록 조회
// ───────────────────────────────────────────────

/**
 * 전체 학생 수 조회 (대시보드 통계용).
 */
export async function getStudentCount(): Promise<number> {
  await requireAdmin();
  const db = createDb();
  const rows = await db
    .select({ value: count() })
    .from(profiles)
    .where(eq(profiles.role, "student"));
  return Number(rows[0]?.value ?? 0);
}

// ───────────────────────────────────────────────
// 학생 계정 생성
// ───────────────────────────────────────────────

export type CreateStudentState = {
  error?: string;
  success?: boolean;
};

/**
 * 학생 계정 생성 서버 액션 (FormData 기반).
 * @param _prev - 이전 상태 (useActionState용)
 * @param formData - { email, password, displayName }
 */
export async function createStudent(
  _prev: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  await requireAdmin();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const displayName = formData.get("displayName") as string;

  // 입력 검증
  if (!email || !password || !displayName) {
    return { error: "모든 필드를 입력해주세요." };
  }
  if (password.length < 8) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }

  const db = createDb();

  // 이메일 중복 확인
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, email))
    .limit(1);

  if (existing.length > 0) {
    return { error: "이미 존재하는 이메일입니다." };
  }

  // 비밀번호 해시 및 계정 삽입
  const passwordHash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  await db.insert(profiles).values({
    id,
    email,
    passwordHash,
    displayName,
    role: "student",
  });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin");
}

// ───────────────────────────────────────────────
// 학생 단건 조회
// ───────────────────────────────────────────────

/**
 * ID로 학생 단건 조회.
 * @param studentId - 학생 ID
 */
export async function getStudentById(studentId: string) {
  await requireAdmin();
  return findStudentTarget(studentId);
}

// ───────────────────────────────────────────────
// 학생 통합 스탯 조회 (Admin Dashboard 용)
// ───────────────────────────────────────────────

/**
 * 모든 학생 레코드와 함께 진행 상황 스탯을 병합하여 반환합니다.
 */
export async function getStudentRosterStats(): Promise<StudentRosterStat[]> {
  await requireAdmin();
  return queryStudentRosterStats(createDb());
}
