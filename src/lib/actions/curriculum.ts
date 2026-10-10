/**
 * @file src/lib/actions/curriculum.ts
 * @description 커리큘럼(학습 모듈) 관련 서버 액션.
 * Admin: 모듈 생성/수정/삭제.
 * Student: 완료 여부 토글, 본인 모듈 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { curriculums } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import {
  requireAuth,
  requireStudentOwnerOrAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/**
 * 특정 학생의 커리큘럼 목록 조회 (주차 오름차순).
 */
export async function getCurriculumByStudent(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  return db
    .select()
    .from(curriculums)
    .where(eq(curriculums.studentId, studentId))
    .orderBy(asc(curriculums.weekNum));
}

/**
 * 학생 본인의 커리큘럼 조회 (세션 기반).
 */
export async function getMyCurriculum() {
  const session = await requireAuth();
  return getCurriculumByStudent(session.user.id!);
}

/**
 * 가장 최근 미완료 모듈 1개 조회 (Student Dashboard 현재 모듈용).
 */
export async function getCurrentModule(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  const rows = await db
    .select()
    .from(curriculums)
    .where(
      and(
        eq(curriculums.studentId, studentId),
        eq(curriculums.isCompleted, false),
      ),
    )
    .orderBy(asc(curriculums.weekNum))
    .limit(1);
  return rows[0] ?? null;
}

// ───────────────────────────────────────────────
// Admin: 모듈 생성
// ───────────────────────────────────────────────

export type CreateModuleState = { error?: string; success?: boolean };

function parseModuleInput(formData: FormData):
  | { ok: true; title: string; weekNum: number }
  | { ok: false; error: string } {
  const title = String(formData.get("title") ?? "").trim();
  const weekNum = Number(formData.get("weekNum"));

  if (!title) return { ok: false, error: "제목을 입력해주세요." };
  if (title.length > 120) return { ok: false, error: "모듈 제목은 120자까지 입력할 수 있습니다." };
  if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 520) {
    return { ok: false, error: "주차는 1부터 520 사이의 정수로 입력해 주세요." };
  }
  return { ok: true, title, weekNum };
}

function revalidateCurriculumPaths(studentId: string): void {
  revalidatePath(`/dashboard/admin/students/${studentId}`);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/student");
}

/**
 * 학생에게 커리큘럼 모듈 추가 (Admin 전용).
 * @param studentId - 대상 학생 ID
 * @param _prev - useActionState 이전 상태
 * @param formData - { weekNum, title }
 */
export async function createModule(
  studentId: string,
  _prev: CreateModuleState,
  formData: FormData,
): Promise<CreateModuleState> {
  await requireStudentTarget(studentId);

  const input = parseModuleInput(formData);
  if (!input.ok) return { error: input.error };

  const db = createDb();
  await db.insert(curriculums).values({
    id: crypto.randomUUID(),
    studentId,
    weekNum: input.weekNum,
    title: input.title,
    isCompleted: false,
  });

  revalidateCurriculumPaths(studentId);
  return { success: true };
}

/**
 * 커리큘럼 모듈의 주차·제목 수정 (Admin 전용). 완료 여부는 학생이 관리하므로 바꾸지 않는다.
 */
export async function updateModule(
  moduleId: string,
  studentId: string,
  _prev: CreateModuleState,
  formData: FormData,
): Promise<CreateModuleState> {
  await requireStudentTarget(studentId);

  const input = parseModuleInput(formData);
  if (!input.ok) return { error: input.error };

  const db = createDb();
  const updated = await db
    .update(curriculums)
    .set({ title: input.title, weekNum: input.weekNum })
    .where(and(eq(curriculums.id, moduleId), eq(curriculums.studentId, studentId)))
    .returning({ id: curriculums.id });
  if (updated.length === 0) return { error: "모듈을 찾을 수 없습니다. 화면을 새로고침해 주세요." };

  revalidateCurriculumPaths(studentId);
  return { success: true };
}

// ───────────────────────────────────────────────
// Student: 완료 토글
// ───────────────────────────────────────────────

/**
 * 모듈 완료 여부 토글 (본인 모듈만 가능).
 */
export async function toggleModuleComplete(moduleId: string, current: boolean) {
  const session = await requireAuth();
  const db = createDb();

  // 본인 모듈인지 확인
  const [mod] = await db
    .select({ studentId: curriculums.studentId })
    .from(curriculums)
    .where(eq(curriculums.id, moduleId))
    .limit(1);

  if (!mod || mod.studentId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  await db
    .update(curriculums)
    .set({ isCompleted: !current })
    .where(eq(curriculums.id, moduleId));

  revalidatePath("/dashboard/student");
}

// ───────────────────────────────────────────────
// Admin: 모듈 삭제
// ───────────────────────────────────────────────

/**
 * 커리큘럼 모듈 삭제 (Admin 전용).
 */
export async function deleteModule(moduleId: string, studentId: string) {
  await requireStudentTarget(studentId);
  const db = createDb();
  await db
    .delete(curriculums)
    .where(
      and(
        eq(curriculums.id, moduleId),
        eq(curriculums.studentId, studentId),
      ),
    );
  revalidateCurriculumPaths(studentId);
}
