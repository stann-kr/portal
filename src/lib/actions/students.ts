/**
 * @file src/lib/actions/students.ts
 * @description 학생 계정 관련 서버 액션.
 * Admin 전용: 학생 생성(초대), 목록 조회, 비밀번호 초기화.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import {
  findStudentTarget,
  requireAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";
import { newPasswordPolicyError } from "@/lib/password-policy";
import {
  generateTemporaryPassword,
  isTemporaryPasswordHash,
  temporaryPasswordHash,
} from "@/lib/password-storage";
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

const STUDENT_NAME_MAX_LENGTH = 60;
const STUDENT_EMAIL_MAX_LENGTH = 254;

/**
 * 학생 계정 생성 서버 액션 (FormData 기반).
 * 이메일은 trim·소문자로 저장해 로그인 입력의 대소문자 차이와 중복 계정을 막는다.
 * @param _prev - 이전 상태 (useActionState용)
 * @param formData - { email, password, displayName }
 */
export async function createStudent(
  _prev: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();

  // 입력 검증
  if (!email || !password || !displayName) {
    return { error: "모든 필드를 입력해주세요." };
  }
  if (displayName.length > STUDENT_NAME_MAX_LENGTH) {
    return { error: `이름은 ${STUDENT_NAME_MAX_LENGTH}자까지 입력할 수 있습니다.` };
  }
  if (email.length > STUDENT_EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return { error: "올바른 이메일 주소를 입력해 주세요." };
  }
  const passwordError = newPasswordPolicyError(password);
  if (passwordError) return { error: passwordError };

  const db = createDb();

  // 이메일 중복 확인 (기존 대소문자 혼합 계정 포함)
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.email}) = ${email}`)
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
  // 바로 커리큘럼·레슨을 등록할 수 있도록 새 학생 상세로 이동한다.
  redirect(`/dashboard/admin/students/${encodeURIComponent(id)}?tab=overview`);
}

// ───────────────────────────────────────────────
// 학생 비밀번호 초기화
// ───────────────────────────────────────────────

/**
 * 비밀번호를 잊은 학생에게 임시 비밀번호를 발급한다. 원문은 이 응답으로 한 번만 돌려주고
 * hash만 저장한다. 저장 hash가 바뀌어 학생의 기존 로그인은 모두 만료되고, 임시 비밀번호로
 * 로그인한 session은 학생이 새 비밀번호를 정하기 전까지 포털 기능을 쓸 수 없다.
 * 관리자가 학생 계정으로 조용히 활동하지 못하게 하는 경계다.
 */
export async function resetStudentPassword(studentId: string): Promise<string> {
  const student = await requireStudentTarget(studentId);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = temporaryPasswordHash(await bcrypt.hash(temporaryPassword, 10));

  const updated = await createDb()
    .update(profiles)
    .set({ passwordHash })
    .where(and(eq(profiles.id, student.id), eq(profiles.role, "student")))
    .returning({ id: profiles.id });
  if (updated.length === 0) throw new Error("Student not found");
  return temporaryPassword;
}

/** 학생이 아직 임시 비밀번호를 새 비밀번호로 바꾸지 않았는지 확인한다. */
export async function getStudentPasswordChangePending(studentId: string): Promise<boolean> {
  const student = await requireStudentTarget(studentId);
  const [row] = await createDb()
    .select({ passwordHash: profiles.passwordHash })
    .from(profiles)
    .where(eq(profiles.id, student.id))
    .limit(1);
  return isTemporaryPasswordHash(row?.passwordHash);
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
