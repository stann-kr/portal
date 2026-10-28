"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { externalCalendarSubscriptions } from "@/db/schema";
import {
  ExternalCalendarError,
  encryptExternalCalendarUrl,
  normalizeExternalCalendarUrl,
  validateExternalCalendarConnection,
  type ExternalCalendarConnectionSummary,
} from "@/lib/external-calendar";
import { getExternalCalendarEncryptionKey } from "@/lib/external-calendar-key";
import { requireAuth } from "@/lib/auth-guard";

export type ExternalCalendarMutationState = { success?: string; error?: string };

function requireStudent(session: Awaited<ReturnType<typeof requireAuth>>) {
  if (session.user.role !== "student") throw new Error("Student only");
  return session.user.id;
}

function revalidateCalendars() {
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
}

export async function getExternalCalendarConnectionSummary(): Promise<ExternalCalendarConnectionSummary> {
  const session = await requireAuth();
  const studentId = requireStudent(session);
  const [subscription] = await createDb()
    .select({ provider: externalCalendarSubscriptions.provider, label: externalCalendarSubscriptions.label })
    .from(externalCalendarSubscriptions)
    .where(eq(externalCalendarSubscriptions.studentId, studentId))
    .limit(1);
  return subscription ? { connected: true, provider: subscription.provider, label: subscription.label } : { connected: false };
}

/**
 * 공개 URL이 실제 iCal로 읽히고 파싱되는 경우에만 암호화해 upsert한다.
 * 제공자는 주소의 host로 정해 선택 값과 주소가 어긋나는 실패를 만들지 않는다.
 * 주소 형식 안내만 그대로 보여 주고, 읽기·설정 실패는 원문 없이 고정 안내로 바꾼다.
 */
export async function connectExternalCalendar(
  _previous: ExternalCalendarMutationState,
  formData: FormData,
): Promise<ExternalCalendarMutationState> {
  const session = await requireAuth();
  const studentId = requireStudent(session);
  const rawUrl = formData.get("url");
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { error: "공개 iCal 주소를 입력해 주세요." };
  }
  let provider: ReturnType<typeof normalizeExternalCalendarUrl>["provider"];
  try {
    provider = normalizeExternalCalendarUrl(rawUrl).provider;
  } catch (error) {
    return {
      error: error instanceof ExternalCalendarError
        ? error.message
        : "공개 iCal URL 형식이 올바르지 않습니다.",
    };
  }
  let encryptionKey: Uint8Array;
  try {
    encryptionKey = getExternalCalendarEncryptionKey();
  } catch {
    return { error: "지금은 공개 레슨 캘린더를 연결할 수 없습니다. Stann에게 문의해 주세요." };
  }
  try {
    const normalized = await validateExternalCalendarConnection({
      provider,
      url: rawUrl,
      studentId,
      spaceLabel: session.user.name?.trim() || session.user.email || "학생",
    });
    const encrypted = await encryptExternalCalendarUrl({
      url: normalized.url,
      studentId,
      provider: normalized.provider,
      key: encryptionKey,
    });
    const db = createDb();
    await db.insert(externalCalendarSubscriptions).values({
      id: crypto.randomUUID(),
      studentId,
      provider: normalized.provider,
      label: normalized.label,
      ...encrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: externalCalendarSubscriptions.studentId,
      set: { provider: normalized.provider, label: normalized.label, ...encrypted, updatedAt: new Date() },
    });
    revalidateCalendars();
    return { success: "공개 레슨 캘린더를 연결했습니다." };
  } catch {
    return { error: "주소에서 공개 캘린더를 읽지 못했습니다. 캘린더가 공개 상태인지와 iCal 주소를 확인해 주세요." };
  }
}

export async function disconnectExternalCalendar(): Promise<void> {
  const session = await requireAuth();
  const studentId = requireStudent(session);
  await createDb().delete(externalCalendarSubscriptions).where(eq(externalCalendarSubscriptions.studentId, studentId));
  revalidateCalendars();
}
