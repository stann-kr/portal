/**
 * 연결 자격 증명 저장(관리자·provider당 연결 하나). server action이 아닌 일반 module이라 권한을 검사하지 않는다
 * (호출하는 action·route가 먼저 관리자를 검증한다). 자격 증명 원문은 돌려주지 않는다.
 */
import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { calendarConnections, type ExternalCalendarProvider } from "@/db/schema";
import { encryptConnectionCredentials, type ConnectionCredentials } from "./credentials";

const MAX_LABEL_LENGTH = 200;

/** 같은 관리자·provider 연결이 있으면 그 id를 재사용해 자격 증명을 바꾸고(매핑 유지) 없으면 새로 만든다. */
export async function upsertCalendarConnection<P extends ExternalCalendarProvider>(
  db: DrizzleDb,
  input: {
    ownerId: string;
    provider: P;
    accountLabel: string;
    credentials: ConnectionCredentials<P>;
    key: Uint8Array;
  },
): Promise<void> {
  const [existing] = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.ownerId, input.ownerId), eq(calendarConnections.provider, input.provider)))
    .limit(1);
  const id = existing?.id ?? crypto.randomUUID();
  const encrypted = await encryptConnectionCredentials({
    connectionId: id,
    provider: input.provider,
    credentials: input.credentials,
    key: input.key,
  });
  const accountLabel = input.accountLabel.slice(0, MAX_LABEL_LENGTH);
  if (existing) {
    await db
      .update(calendarConnections)
      .set({ ...encrypted, accountLabel, status: "ACTIVE", lastError: null, updatedAt: new Date() })
      .where(eq(calendarConnections.id, id));
    return;
  }
  await db.insert(calendarConnections).values({
    id,
    ownerId: input.ownerId,
    provider: input.provider,
    accountLabel,
    ...encrypted,
    status: "ACTIVE",
  });
}
