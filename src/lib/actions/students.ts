/**
 * @file src/lib/actions/students.ts
 * @description 학생 계정 관련 서버 액션.
 * Admin 전용: 학생 생성(가입 링크), 목록 조회, 비밀번호 초기화.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDb, createDbContext } from "@/db/client";
import { lessons, profiles } from "@/db/schema";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import {
  findStudentTarget,
  requireAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";
import {
  generateInviteSecret,
  generateTemporaryPassword,
  inviteHash,
  parseInviteHash,
  storedCredentialState,
  temporaryPasswordHash,
  type StoredCredentialState,
} from "@/lib/password-storage";
import { buildInvitePath, INVITE_LIFETIME_MS } from "@/lib/invite-token";
import { sendInviteEmail, type InviteEmailStatus } from "@/lib/invite-email";
import { isProfileDuplicate } from "@/lib/db-errors";
import {
  queryStudentRosterStats,
  queryStudentWorkCounts,
  withConnectedNextLessons,
  type StudentRosterStat,
  type StudentWorkCounts,
} from "@/lib/student-roster";
import { queryConnectedNextEvents } from "@/lib/connected-next-lesson";
import {
  activeStudentProfileCondition,
  ACTIVE_ACCOUNT_STATUS,
  ARCHIVED_ACCOUNT_STATUS,
} from "@/lib/student-status";
import { readLessonGroupMemberIds, readStudentLessonGroupId } from "@/lib/lesson-groups";
import {
  markLinksDeletedStatement,
  schedulePruneDeletedStudentCalendarCopies,
  schedulePushStudentsCalendarChanges,
} from "@/lib/calendar-sync/sync-runner";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import { fetchExternalItemsForUser } from "@/lib/external-items";
import { deletePristineStudentAtomically } from "@/lib/account-privacy-atomic";
import { readStudentDeletionState, type StudentDeletionState } from "@/lib/student-deletion";

export type { StudentRosterStat, StudentWorkCounts } from "@/lib/student-roster";

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
    .where(activeStudentProfileCondition());
  return Number(rows[0]?.value ?? 0);
}

// ───────────────────────────────────────────────
// 학생 계정 생성
// ───────────────────────────────────────────────

export type CreateStudentState = {
  error?: string;
  /** 만든 학생. 가입 링크는 이 응답으로 한 번만 돌려준다. */
  created?: { studentId: string; displayName: string; email: string; invitePath: string; emailStatus: InviteEmailStatus };
};

const STUDENT_NAME_MAX_LENGTH = 60;
const STUDENT_EMAIL_MAX_LENGTH = 254;

/** 7일 동안 한 번 쓸 수 있는 가입 링크 secret을 만들고 저장할 hash와 링크 경로를 돌려준다. */
async function issueInvite(studentId: string): Promise<{ passwordHash: string; invitePath: string; expiresAt: Date }> {
  const secret = generateInviteSecret();
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS);
  return {
    passwordHash: inviteHash(await bcrypt.hash(secret, 10), expiresAt),
    invitePath: buildInvitePath(studentId, secret),
    expiresAt,
  };
}

/**
 * 학생 계정 생성 서버 액션 (FormData 기반).
 * 관리자는 비밀번호를 정하지 않고 가입 링크를 받는다. 학생이 링크에서 직접 비밀번호를 정하기 전에는
 * 로그인할 수 없다. 이메일은 trim·소문자로 저장해 로그인 입력의 대소문자 차이와 중복 계정을 막는다.
 * @param _prev - 이전 상태 (useActionState용)
 * @param formData - { email, displayName }
 */
export async function createStudent(
  _prev: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim();

  // 입력 검증
  if (!email || !displayName) {
    return { error: "이름과 이메일을 모두 입력해 주세요." };
  }
  if (displayName.length > STUDENT_NAME_MAX_LENGTH) {
    return { error: `이름은 ${STUDENT_NAME_MAX_LENGTH}자까지 입력할 수 있습니다.` };
  }
  if (email.length > STUDENT_EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return { error: "올바른 이메일 주소를 입력해 주세요." };
  }
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

  const id = crypto.randomUUID();
  const { passwordHash, invitePath, expiresAt } = await issueInvite(id);

  try {
    await db.insert(profiles).values({
      id,
      email,
      passwordHash,
      displayName,
      role: "student",
    });
  } catch (error) {
    // 같은 이메일을 동시에 만들면(두 번 누름·두 탭) 위 확인을 둘 다 지나도 DB(INSERT trigger·unique index)가 막는다.
    // id는 방금 만든 UUID라 여기서 겹치는 것은 이메일이다.
    if (isProfileDuplicate(error)) return { error: "이미 존재하는 이메일입니다." };
    throw error;
  }

  revalidatePath("/dashboard/admin");
  // 계정은 이미 만들었으므로 메일이 실패해도 화면의 링크로 전달할 수 있다.
  const emailStatus = await sendInviteEmail({ to: email, displayName, invitePath, expiresAt });
  return { created: { studentId: id, displayName, email, invitePath, emailStatus } };
}

export type ReissuedInvite = { invitePath: string; email: string; emailStatus: InviteEmailStatus };

/**
 * 아직 가입하지 않은 학생의 가입 링크를 다시 발급하고 학생 이메일로 보낸다. 이전 링크는 바로 쓸 수 없게 된다.
 * 이미 비밀번호를 정한 학생은 임시 비밀번호 발급을 쓴다.
 */
export async function reissueStudentInvite(studentId: string): Promise<ReissuedInvite> {
  const student = await requireStudentTarget(studentId);
  const db = createDb();
  const [row] = await db
    .select({ passwordHash: profiles.passwordHash, email: profiles.email, displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, student.id))
    .limit(1);
  if (!row?.passwordHash || !parseInviteHash(row.passwordHash)) throw new Error("Invite unavailable");

  const { passwordHash, invitePath, expiresAt } = await issueInvite(student.id);
  const updated = await db
    .update(profiles)
    .set({ passwordHash })
    .where(and(eq(profiles.id, student.id), eq(profiles.passwordHash, row.passwordHash)))
    .returning({ id: profiles.id });
  if (updated.length === 0) throw new Error("Invite changed");
  const emailStatus = await sendInviteEmail({ to: row.email, displayName: row.displayName ?? "", invitePath, expiresAt });
  return { invitePath, email: row.email, emailStatus };
}

// ───────────────────────────────────────────────
// 학생 비밀번호 초기화
// ───────────────────────────────────────────────

/**
 * 비밀번호를 잊은 학생에게 임시 비밀번호를 발급한다. 원문은 이 응답으로 한 번만 돌려주고
 * hash만 저장한다. 저장 hash가 바뀌어 학생의 기존 로그인은 모두 만료되고, 임시 비밀번호로
 * 로그인한 session은 학생이 새 비밀번호를 정하기 전까지 포탈 기능을 쓸 수 없다.
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

/** 학생 계정이 가입 대기·임시 비밀번호·일반 중 어느 상태인지 확인한다. hash는 돌려주지 않는다. */
export async function getStudentAccountState(studentId: string): Promise<StoredCredentialState> {
  const student = await requireStudentTarget(studentId);
  const [row] = await createDb()
    .select({ passwordHash: profiles.passwordHash })
    .from(profiles)
    .where(eq(profiles.id, student.id))
    .limit(1);
  return storedCredentialState(row?.passwordHash);
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
  const db = createDb();
  const referenceTime = new Date();
  // 연결된 바깥 캘린더의 일정도 다음 레슨으로 센다.
  const [stats, connected] = await Promise.all([
    queryStudentRosterStats(db, referenceTime),
    queryConnectedNextEvents(db, referenceTime, fetchExternalItemsForUser),
  ]);
  return withConnectedNextLessons(stats, connected);
}

/** 학생 상세 탭 숫자: 검토 대기 제출 수와 미답변 질문 수. 활성 학생만 센다. */
export async function getStudentWorkCounts(studentId: string): Promise<StudentWorkCounts> {
  const student = await requireStudentTarget(studentId);
  return queryStudentWorkCounts(createDb(), student.id);
}

export type StudentOption = { id: string; name: string };

/** 과제를 함께 낼 학생 목록(UsabilityBundle ⑭): 학생 계정 id와 표시 이름. 받는 쪽 검증은 각 action이 다시 한다. */
export async function getStudentOptions(): Promise<StudentOption[]> {
  await requireAdmin();
  const rows = await createDb()
    .select({ id: profiles.id, email: profiles.email, displayName: profiles.displayName })
    .from(profiles)
    .where(activeStudentProfileCondition())
    .orderBy(profiles.displayName, profiles.email);
  return rows.map((row) => ({ id: row.id, name: row.displayName?.trim() || row.email }));
}

// ───────────────────────────────────────────────
// 수강 종료(보관)·복원 (2026-11-18 사용자 결정)
// ───────────────────────────────────────────────

export type StudentArchiveResult = { ok: true; name: string } | { ok: false; error: string };

/** 수강 종료 뒤 돌아가는 학생 목록. */
const ADMIN_STUDENTS_PATH = "/dashboard/admin?section=students";

function archiveDisplayName(row: { displayName: string | null; email: string }): string {
  return row.displayName?.trim() || row.email;
}

function revalidateStudentLists() {
  // 학생 목록·선택지·업무함과 사이드바 숫자가 모두 바뀐다.
  revalidatePath("/dashboard", "layout");
}

/**
 * 수강 종료·복원으로 그룹의 수강 중인 멤버가 바뀌면 그룹레슨 판정이 달라진다(그룹 멤버를 바꿀 때와 같다).
 * 그룹 캘린더와 멤버 개인 캘린더를 응답 뒤에 맞춘다. 수강 종료한 학생 본인 캘린더는 엔진이 건너뛴다.
 */
async function scheduleGroupCalendarResync(studentId: string) {
  const context = createDbContext();
  const groupId = await readStudentLessonGroupId(context, studentId);
  const memberIds = groupId ? await readLessonGroupMemberIds(context, groupId) : [];
  await schedulePushStudentsCalendarChanges([...memberIds, studentId]);
}

const ARCHIVE_TARGET_MISSING = "이미 수강을 종료했거나 찾을 수 없는 학생입니다. 학생 목록을 새로 고쳐 주세요.";

function isBatchAbort(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error) + String((error as { cause?: unknown })?.cause ?? "");
  return text.includes("DOCUMENT_BATCH_ABORT");
}

/**
 * 학생의 수강을 종료(보관)한다. 기록은 지우지 않고 계정 상태만 바꾼다. 상태가 바뀌면 그 학생의 session은
 * 다음 인증 확인에서 끝나고(parseActiveProfile), 로그인·목록·선택지·알림·캘린더 동기화에서 빠진다.
 * 수강 중인 학생일 때만 바꾸는 조건부 UPDATE라 두 번 눌러도 한 번만 반영된다. 관리자 계정은 대상이 아니다.
 *
 * deleteUpcomingLessons가 true면 지금 이후 예정 레슨(레슨 목록의 '예정'과 같은 기준)을 같은 batch에서 지운다
 * (캔버스 UxReview1120Policies ⑨, 2026-11-20 사용자 결정). 그룹레슨도 이 학생 몫만 지우고 다른 멤버 레슨은 남긴다
 * (deleteLesson처럼 멤버 모두로 넓히지 않는다). 상태가 이미 바뀌었으면 batch 전체가 되돌아가 레슨도 남는다.
 * 지운 레슨의 원격 캘린더 사본은 응답 뒤 지운 항목만 정리하는 동기화로 지운다(수강 종료 학생은 일반 동기화를 멈춘다).
 * 성공하면 학생 목록으로 이동한다(학생 상세는 더 열 수 없다). 실패만 상태로 돌려준다.
 */
export async function archiveStudent(
  studentId: string,
  deleteUpcomingLessons: boolean = false,
): Promise<Extract<StudentArchiveResult, { ok: false }>> {
  await requireAdmin();
  const student = typeof studentId === "string" && studentId ? await findStudentTarget(studentId) : null;
  if (!student) return { ok: false, error: ARCHIVE_TARGET_MISSING };
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const upcomingIds = deleteUpcomingLessons === true
    ? (await createDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.studentId, student.id), gte(lessons.scheduledAt, now)))).map((row) => row.id)
    : [];
  const statements: DocumentAtomicStatement[] = [
    {
      query: "UPDATE profiles SET account_status = ?, archived_at = ? WHERE id = ? AND role = 'student' AND account_status = ?",
      params: [ARCHIVED_ACCOUNT_STATUS, nowSeconds, student.id, ACTIVE_ACCOUNT_STATUS],
    },
    DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    // 읽은 뒤 지난 시각으로 옮긴 레슨은 지우지 않는다(남은 DELETED 표시는 다음 동기화가 로컬 내용으로 되돌린다).
    ...upcomingIds.flatMap((lessonId) => [
      markLinksDeletedStatement("LESSON", lessonId, student.id, now),
      { query: "DELETE FROM lessons WHERE id = ? AND student_id = ? AND scheduled_at >= ?", params: [lessonId, student.id, nowSeconds] },
    ]),
  ];
  try {
    await executeDocumentStatementsAtomically(createDbContext(), statements);
  } catch (error) {
    if (isBatchAbort(error)) return { ok: false, error: ARCHIVE_TARGET_MISSING };
    throw error;
  }
  revalidateStudentLists();
  await scheduleGroupCalendarResync(student.id);
  if (upcomingIds.length > 0) await schedulePruneDeletedStudentCalendarCopies(student.id);
  redirect(ADMIN_STUDENTS_PATH);
}

/** 수강 종료한 학생을 복원한다. 기록·비밀번호·그룹 자리·캘린더 연결은 그대로라 바로 다시 로그인할 수 있다. */
export async function restoreStudent(studentId: string): Promise<StudentArchiveResult> {
  await requireAdmin();
  if (typeof studentId !== "string" || !studentId) {
    return { ok: false, error: "학생을 찾지 못했습니다. 목록을 새로 고쳐 주세요." };
  }
  const updated = await createDb()
    .update(profiles)
    .set({ accountStatus: ACTIVE_ACCOUNT_STATUS, archivedAt: null })
    .where(and(
      eq(profiles.id, studentId),
      eq(profiles.role, "student"),
      eq(profiles.accountStatus, ARCHIVED_ACCOUNT_STATUS),
    ))
    .returning({ id: profiles.id, displayName: profiles.displayName, email: profiles.email });
  if (updated.length === 0) {
    return { ok: false, error: "이미 복원했거나 찾을 수 없는 학생입니다. 목록을 새로 고쳐 주세요." };
  }
  revalidateStudentLists();
  await scheduleGroupCalendarResync(studentId);
  return { ok: true, name: archiveDisplayName(updated[0]!) };
}

export type ArchivedStudent = { id: string; email: string; displayName: string | null; archivedAt: Date | null };

/** 수강 종료한 학생(최근에 종료한 학생부터). 상태를 보지 않는 별도 조회라 학생 대상 action 경계와 섞지 않는다. */
export async function getArchivedStudents(): Promise<ArchivedStudent[]> {
  await requireAdmin();
  return createDb()
    .select({ id: profiles.id, email: profiles.email, displayName: profiles.displayName, archivedAt: profiles.archivedAt })
    .from(profiles)
    .where(and(eq(profiles.role, "student"), eq(profiles.accountStatus, ARCHIVED_ACCOUNT_STATUS)))
    .orderBy(desc(profiles.archivedAt), profiles.displayName, profiles.email);
}

/** 학생 목록 아래 '수강 종료한 학생 N명' 링크의 숫자. 0이면 링크를 그리지 않는다. */
export async function getArchivedStudentCount(): Promise<number> {
  await requireAdmin();
  const rows = await createDb()
    .select({ value: count() })
    .from(profiles)
    .where(and(eq(profiles.role, "student"), eq(profiles.accountStatus, ARCHIVED_ACCOUNT_STATUS)));
  return Number(rows[0]?.value ?? 0);
}

// ───────────────────────────────────────────────
// 학생 삭제: 가입 전·기록 없는 학생만 (2026-11-18 사용자 결정)
// ───────────────────────────────────────────────

export type { StudentDeletionState } from "@/lib/student-deletion";

/** 학생 상세 계정 구역의 삭제 상태(버튼·이유 안내). 판정 기준은 `student-deletion.ts` 한 군데에 있다. */
export async function getStudentDeletionState(studentId: string): Promise<StudentDeletionState> {
  const student = await requireStudentTarget(studentId);
  // 방금 수강 종료했거나 사라졌으면 버튼을 보이지 않는다.
  return (await readStudentDeletionState(createDbContext(), student.id)) ?? { kind: "signed-up" };
}

/**
 * 가입 전이면서 기록·그룹 자리가 없는 학생을 지운다. 계정·가입 링크와 관리자가 만든 설정(캘린더 구독 URL·가이드 공개)이
 * 함께 지워지고 되돌릴 수 없다. 조건은 삭제 batch 안에서 다시 확인하므로, 그사이 가입했거나 기록이 생기면 아무것도
 * 지우지 않고 실패를 돌려준다. 성공하면 학생 목록으로 이동한다.
 */
export async function deleteStudent(studentId: string): Promise<{ ok: false; error: string }> {
  await requireAdmin();
  const student = typeof studentId === "string" && studentId ? await findStudentTarget(studentId) : null;
  if (!student) {
    return { ok: false, error: "이미 삭제했거나 찾을 수 없는 학생입니다. 학생 목록을 새로 고쳐 주세요." };
  }
  const result = await deletePristineStudentAtomically(createDbContext(), { studentId: student.id, now: new Date() });
  if (!result.ok) {
    return { ok: false, error: "가입했거나 기록이 생겨 삭제하지 않았습니다. 수강 종료를 쓰세요." };
  }
  revalidateStudentLists();
  redirect(ADMIN_STUDENTS_PATH);
}
