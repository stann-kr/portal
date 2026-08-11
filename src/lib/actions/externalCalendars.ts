"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { externalCalendarSubscriptions } from "@/db/schema";
import {
  encryptExternalCalendarUrl,
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

/** 공개 URL이 실제 iCal로 읽히고 파싱되는 경우에만 암호화해 upsert한다. */
export async function connectExternalCalendar(
  _previous: ExternalCalendarMutationState,
  formData: FormData,
): Promise<ExternalCalendarMutationState> {
  const session = await requireAuth();
  const studentId = requireStudent(session);
  try {
    const configuredProvider = formData.get("provider");
    const rawUrl = formData.get("url");
    if ((configuredProvider !== "GOOGLE" && configuredProvider !== "ICLOUD") || typeof rawUrl !== "string") {
      return { error: "캘린더 제공자와 공개 iCal 주소를 확인해 주세요." };
    }
    const encryptionKey = getExternalCalendarEncryptionKey();
    const normalized = await validateExternalCalendarConnection({
      provider: configuredProvider,
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
    return { error: "공개 레슨 캘린더를 연결하지 못했습니다. 주소와 공개 상태를 확인해 주세요." };
  }
}

export async function disconnectExternalCalendar(): Promise<void> {
  const session = await requireAuth();
  const studentId = requireStudent(session);
  await createDb().delete(externalCalendarSubscriptions).where(eq(externalCalendarSubscriptions.studentId, studentId));
  revalidateCalendars();
}
