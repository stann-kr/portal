/**
 * @file src/lib/actions/calendarEvents.ts
 * @description 개인 캘린더 이벤트 CRUD 서버 액션 (Phase 4).
 * 본인 이벤트만 조회/수정/삭제 가능.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import type { CalendarEventType } from "@/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-guard";
import {
  parseCalendarEventCreateInput,
  parseCalendarEventUpdateInput,
} from "@/lib/calendar-event-contract";

// ─── 조회 ────────────────────────────────────────

/**
 * 특정 기간의 본인 캘린더 이벤트 목록 조회.
 * @param start 조회 시작 시각 (ISO string)
 * @param end   조회 종료 시각 (ISO string)
 */
export async function getCalendarEvents(start: string, end: string) {
  const session = await requireAuth();
  const db = createDb();

  return db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, session.user.id!),
        gte(calendarEvents.startTime, new Date(start)),
        lte(calendarEvents.startTime, new Date(end)),
      ),
    );
}

// ─── 생성 ────────────────────────────────────────

export type CreatedCalendarEvent = {
  id: string;
  title: string;
  eventType: CalendarEventType;
  startTime: string;
  endTime: string | null;
  description: string | null;
};

export type CreateEventState = {
  error?: string;
  id?: string;
  event?: CreatedCalendarEvent;
};

/**
 * 캘린더 이벤트 생성.
 */
export async function createCalendarEvent(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const session = await requireAuth();
  const parsed = parseCalendarEventCreateInput({
    title: formData.get("title"),
    eventType: formData.get("eventType"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    description: formData.get("description"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const db = createDb();
  const id = crypto.randomUUID();

  await db.insert(calendarEvents).values({
    id,
    userId: session.user.id!,
    ...parsed.value,
    endTime: parsed.value.endTime ?? undefined,
  });

  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/student");
  return {
    id,
    event: {
      id,
      title: parsed.value.title,
      eventType: parsed.value.eventType,
      startTime: parsed.value.startTime.toISOString(),
      endTime: parsed.value.endTime?.toISOString() ?? null,
      description: parsed.value.description,
    },
  };
}

// ─── 수정 ────────────────────────────────────────

/**
 * 캘린더 이벤트 수정 (드래그&드롭 날짜 변경 포함).
 */
export async function updateCalendarEvent(
  eventId: string,
  data: {
    title?: string;
    eventType?: CalendarEventType;
    startTime?: Date;
    endTime?: Date | null;
    description?: string | null;
  },
) {
  const session = await requireAuth();
  const db = createDb();

  const [current] = await db
    .select({
      title: calendarEvents.title,
      eventType: calendarEvents.eventType,
      startTime: calendarEvents.startTime,
      endTime: calendarEvents.endTime,
      description: calendarEvents.description,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.userId, session.user.id!),
      ),
    )
    .limit(1);
  if (!current) throw new Error("일정을 찾을 수 없거나 권한이 없습니다.");

  const parsed = parseCalendarEventUpdateInput(data, current);
  if (!parsed.ok) throw new Error(parsed.error);

  await db
    .update(calendarEvents)
    .set(parsed.value)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.userId, session.user.id!),
      ),
    );

  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/student");
}

// ─── 삭제 ────────────────────────────────────────

/**
 * 캘린더 이벤트 삭제 (본인 이벤트만).
 */
export async function deleteCalendarEvent(eventId: string) {
  const session = await requireAuth();
  const db = createDb();

  await db
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.userId, session.user.id!),
      ),
    );

  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/student");
}
