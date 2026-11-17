/**
 * 학생 수강 종료(보관) 조건 모음(0032 `profiles.account_status`, 2026-11-18 사용자 결정).
 * 수강 종료한 학생은 기록을 지우지 않고 로그인·목록·선택지·알림·동기화에서만 빠진다. 같은 규칙을 쓰는 곳이 많아
 * 조건을 여기 한 군데에 둔다. 로그인·session·학생 대상 action은 `parseActiveProfile`이 ACTIVE 아닌 계정을 이미 거른다.
 */
import { and, eq, isNull, notInArray, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { DrizzleDb } from "@/db/client";
import { profiles } from "@/db/schema";

export const ACTIVE_ACCOUNT_STATUS = "ACTIVE";
export const ARCHIVED_ACCOUNT_STATUS = "ARCHIVED";

/** `profiles`를 직접 읽는 query: 수강 중인 학생. */
export function activeStudentProfileCondition(): SQL {
  return and(eq(profiles.role, "student"), eq(profiles.accountStatus, ACTIVE_ACCOUNT_STATUS)) as SQL;
}

/**
 * 다른 table의 학생 column이 수강 종료한 학생을 가리키지 않는다. 학생이 없는 행(NULL)은 그대로 둔다.
 * 비상관 subquery(`NOT IN (SELECT id … ARCHIVED)`)라 바깥 table 별칭에 기대지 않는다.
 */
export function notArchivedStudentCondition(db: DrizzleDb, column: SQLiteColumn): SQL {
  return or(
    isNull(column),
    notInArray(column, db.select({ id: profiles.id }).from(profiles).where(eq(profiles.accountStatus, ARCHIVED_ACCOUNT_STATUS))),
  ) as SQL;
}

/** 직접 쓴 SQL(atomic batch)에서 profiles 별칭이 수강 중인 학생인지. 별칭은 코드 상수만 넘긴다. */
export function activeStudentSql(alias: string): string {
  return `${alias}.role = 'student' AND ${alias}.account_status = '${ACTIVE_ACCOUNT_STATUS}'`;
}

/** 직접 쓴 SQL에서 학생 id 식이 수강 종료한 학생이 아닌지(비상관 subquery). */
export function notArchivedStudentSql(idExpression: string): string {
  return `${idExpression} NOT IN (SELECT id FROM profiles WHERE account_status = '${ARCHIVED_ACCOUNT_STATUS}')`;
}
