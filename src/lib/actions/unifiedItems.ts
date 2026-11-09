/**
 * @file src/lib/actions/unifiedItems.ts
 * @description 기간·타입·결과 budget을 강제하는 통합 일정 server action.
 */
"use server";

import { createDb } from "@/db/client";
import { listActiveStudentProfiles } from "@/lib/active-profile";
import { requireAdmin, requireAuth, requireStudentTarget } from "@/lib/auth-guard";
import { fetchExternalItemsForUser } from "@/lib/external-items";
import {
  resolveAllStudentsItemsQuery,
  resolveUnifiedItemsQuery,
  type UnifiedItemsQueryInput,
} from "@/lib/unified-items-query";
import { queryInternalUnifiedItems, queryInternalUnifiedItemsForStudents } from "@/lib/unified-items-store";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

async function fetchInternalItemsForUser(
  userId: string,
  input?: UnifiedItemsQueryInput,
): Promise<UnifiedItem[]> {
  return queryInternalUnifiedItems(
    createDb(),
    userId,
    resolveUnifiedItemsQuery(input),
  );
}

/** 학생 본인의 bounded 내부 일정을 반환한다. */
export async function getUnifiedItems(
  input?: UnifiedItemsQueryInput,
): Promise<UnifiedItem[]> {
  const session = await requireAuth();
  return fetchInternalItemsForUser(session.user.id!, input);
}

/** 특정 학생의 bounded 내부 일정을 반환한다 (관리자 전용). */
export async function getUnifiedItemsForStudent(
  studentId: string,
  input?: UnifiedItemsQueryInput,
): Promise<UnifiedItem[]> {
  await requireStudentTarget(studentId);
  return fetchInternalItemsForUser(studentId, input);
}

/** 내부 일정과 분리해 학생 본인의 외부 공개 feed를 fail-soft로 반환한다. */
export async function getExternalUnifiedItems(
  input?: UnifiedItemsQueryInput,
): Promise<UnifiedItem[]> {
  const session = await requireAuth();
  return fetchExternalItemsForUser(session.user.id!, input);
}

/** 내부 일정과 분리해 대상 학생의 외부 공개 feed를 fail-soft로 반환한다. */
export async function getExternalUnifiedItemsForStudent(
  studentId: string,
  input?: UnifiedItemsQueryInput,
): Promise<UnifiedItem[]> {
  await requireStudentTarget(studentId);
  return fetchExternalItemsForUser(studentId, input);
}

export type AllStudentsUnifiedItems = {
  items: UnifiedItem[];
  /** 실제로 읽은 기간(ISO). 클라이언트는 이 범위를 읽은 범위로 기억한다. */
  start: string;
  end: string;
  /** 상한에 닿아 기간 안 항목 일부가 빠졌을 수 있다. */
  truncated: boolean;
};

/**
 * 관리자 일정 "전체 학생": 모든 활성 학생의 포탈 내부 항목(외부 캘린더 제외)을 보이는 기간만큼 반환한다.
 * 대상 학생은 클라이언트가 보내지 않고 여기서 학생 role profile로 직접 확정한다(학생 대상 action과 같은 활성 학생 규칙).
 */
export async function getUnifiedItemsForAllStudents(
  input?: { start?: string; end?: string },
): Promise<AllStudentsUnifiedItems> {
  await requireAdmin();
  const query = resolveAllStudentsItemsQuery(input);
  const db = createDb();
  const students = await listActiveStudentProfiles(db);
  const { items, truncated } = students.length === 0
    ? { items: [], truncated: false }
    : await queryInternalUnifiedItemsForStudents(db, students.map((student) => student.id), query);
  return { items, start: query.start.toISOString(), end: query.end.toISOString(), truncated };
}
