/**
 * @file src/lib/actions/unifiedItems.ts
 * @description 기간·타입·결과 budget을 강제하는 통합 일정 server action.
 */
"use server";

import { createDb } from "@/db/client";
import { requireAuth, requireStudentTarget } from "@/lib/auth-guard";
import { fetchExternalItemsForUser } from "@/lib/external-items";
import {
  resolveUnifiedItemsQuery,
  type UnifiedItemsQueryInput,
} from "@/lib/unified-items-query";
import { queryInternalUnifiedItems } from "@/lib/unified-items-store";
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
