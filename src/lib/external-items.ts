/**
 * 학생 본인 iCal 구독(읽기 전용) 외부 일정을 fail-soft로 읽는다.
 * server action이 아닌 일반 module이다. 호출하는 action이 대상 사용자 권한을 먼저 검증한다.
 */
import { createDb } from "@/db/client";
import { externalCalendarSubscriptions, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
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
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export async function fetchExternalItemsForUser(
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
