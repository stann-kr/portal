/**
 * @file src/lib/actions/unifiedItems.ts
 * @description 기간·타입·결과 budget을 강제하는 통합 일정 server action.
 */
"use server";

import { createDb } from "@/db/client";
import { externalCalendarSubscriptions, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireStudentTarget } from "@/lib/auth-guard";
import {
  decryptExternalCalendarUrl,
  fetchExternalCalendarIcs,
  parseExternalCalendarItems,
} from "@/lib/external-calendar";
import { getExternalCalendarEncryptionKey } from "@/lib/external-calendar-key";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import {
  resolveUnifiedItemsQuery,
  selectUnifiedItemsWithinQuery,
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

async function fetchExternalItemsForUser(
  userId: string,
  input?: UnifiedItemsQueryInput,
): Promise<UnifiedItem[]> {
  const query = resolveUnifiedItemsQuery(input);
  if (!query.types.includes("EVENT")) return [];
  const db = createDb();
  const [profileRows, subscriptionRows] = await Promise.all([
    db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
    db
      .select()
      .from(externalCalendarSubscriptions)
      .where(eq(externalCalendarSubscriptions.studentId, userId))
      .limit(1),
  ]);
  const profile = profileRows[0];
  const subscription = subscriptionRows[0];
  if (!profile || !subscription) return [];

  // 외부 provider 실패는 내부 일정 action과 렌더를 막지 않는다.
  try {
    const url = await decryptExternalCalendarUrl({
      encryptedUrl: subscription.encryptedUrl,
      urlIv: subscription.urlIv,
      studentId: profile.id,
      provider: subscription.provider,
      key: getExternalCalendarEncryptionKey(),
    });
    const ics = await fetchExternalCalendarIcs(url);
    const externalItems = await parseExternalCalendarItems({
      ics,
      subscriptionId: subscription.id,
      studentId: profile.id,
      provider: subscription.provider,
      spaceLabel: getUnifiedItemSpaceLabel(profile),
      window: { start: query.start, end: query.end },
    });
    return selectUnifiedItemsWithinQuery(externalItems, query);
  } catch {
    return [];
  }
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
