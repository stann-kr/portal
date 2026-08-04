/**
 * @file src/lib/actions/students.ts
 * @description 학생 계정 관련 서버 액션.
 * Admin 전용: 학생 생성(초대), 목록 조회, 삭제.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb } from "@/db/client";
import { profiles, curriculums, lessons, assignments, feedbacks } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/auth-guard";

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
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.role, "student"));
  return rows.length;
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
  const db = createDb();
  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, studentId))
    .limit(1);
  return rows[0] ?? null;
}

// ───────────────────────────────────────────────
// 학생 통합 스탯 조회 (Admin Dashboard 용)
// ───────────────────────────────────────────────

export type StudentRosterStat = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date | null;
  currentModule: string | null;
  nextLessonDate: Date | null;
  pendingFeedbackCount: number;
};

/**
 * 모든 학생 레코드와 함께 진행 상황 스탯을 병합하여 반환합니다.
 */
export async function getStudentRosterStats(): Promise<StudentRosterStat[]> {
  await requireAdmin();
  const db = createDb();

  // 모든 학생 조회
  const allStudents: InferSelectModel<typeof profiles>[] = await db.select().from(profiles).where(eq(profiles.role, "student")).orderBy(desc(profiles.createdAt));

  // 모든 데이터 패치 (학생 수가 매우 많지 않음을 가정)
  // 향후 성능 이슈 시 raw sql join으로 최적화
  const allMods: InferSelectModel<typeof curriculums>[] = await db.select().from(curriculums);
  const allLess: InferSelectModel<typeof lessons>[] = await db.select().from(lessons).orderBy(asc(lessons.scheduledAt));
  const allAssig: InferSelectModel<typeof assignments>[] = await db.select().from(assignments);
  const allFeeds: InferSelectModel<typeof feedbacks>[] = await db.select().from(feedbacks);

  const now = new Date();

  return allStudents.map((st) => {
    // 1. Current Module (완료되지 않은 가장 빠른 주차)
    const stMods = allMods.filter((m) => m.studentId === st.id && !m.isCompleted);
    stMods.sort((a, b) => (a.weekNum ?? 0) - (b.weekNum ?? 0));
    const currentModule = stMods.length > 0
      ? `${stMods[0].weekNum}주차: ${stMods[0].title}`
      : "모든 과정 완료";

    // 2. Next Lesson
    const upcomingLess = allLess.filter((l) => l.studentId === st.id && l.scheduledAt !== null && new Date(l.scheduledAt) >= now);
    const nextLessonDate = upcomingLess.length > 0 ? upcomingLess[0].scheduledAt : null;

    // 3. Pending Feedbacks
    // 학생의 애싸인먼트 중 코멘트(feedback)가 없는 것 개수
    const stAssig = allAssig.filter((a) => a.studentId === st.id);
    const pendingCount = stAssig.filter((a) => {
      // 해당 assignmentId를 가진 피드백이 하나라도 있는지 확인
      const hasFeedback = allFeeds.some((f) => f.assignmentId === a.id);
      return !hasFeedback;
    }).length;

    return {
      id: st.id,
      email: st.email,
      displayName: st.displayName,
      createdAt: st.createdAt,
      currentModule,
      nextLessonDate: nextLessonDate ? new Date(nextLessonDate) : null,
      pendingFeedbackCount: pendingCount,
    };
  });
}
