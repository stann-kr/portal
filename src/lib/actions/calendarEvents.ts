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

type CalendarEventWriteResult =
  | { ok: true; value: CreatedCalendarEvent }
  | { ok: false; error: string };

/** 본인 일정의 현재 값을 기준으로 patch를 검증하고 같은 owner 조건으로만 갱신한다. */
async function writeOwnCalendarEventPatch(
  userId: string,
  eventId: string,
  data: unknown,
): Promise<CalendarEventWriteResult> {
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
        eq(calendarEvents.userId, userId),
      ),
    )
    .limit(1);
  if (!current) return { ok: false, error: "일정을 찾을 수 없거나 권한이 없습니다." };

  const parsed = parseCalendarEventUpdateInput(data, current);
  if (!parsed.ok) return parsed;

  await db
    .update(calendarEvents)
    .set(parsed.value)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.userId, userId),
      ),
    );

  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/student");
  const next = { ...current, ...parsed.value };
  return {
    ok: true,
    value: {
      id: eventId,
      title: next.title,
      eventType: next.eventType,
      startTime: next.startTime.toISOString(),
      endTime: next.endTime?.toISOString() ?? null,
      description: next.description,
    },
  };
}

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
  const result = await writeOwnCalendarEventPatch(session.user.id!, eventId, data);
  if (!result.ok) throw new Error(result.error);
}

export type MoveCalendarEventResult =
  | { ok: true; event: CreatedCalendarEvent }
  | { ok: false; error: string };

/**
 * 캘린더에서 끌어 옮기거나 길이를 바꾼 본인 일정의 시간만 저장한다. 실패는 상태로 돌려 화면이 원위치하게 한다.
 */
export async function moveCalendarEvent(
  eventId: string,
  startTime: string,
  endTime: string | null,
): Promise<MoveCalendarEventResult> {
  const session = await requireAuth();
  if (typeof eventId !== "string" || !eventId) {
    return { ok: false, error: "옮길 일정을 찾을 수 없습니다." };
  }
  const result = await writeOwnCalendarEventPatch(session.user.id!, eventId, { startTime, endTime });
  return result.ok ? { ok: true, event: result.value } : result;
}

/**
 * 상세 패널의 일정 수정 form action. 검증 실패를 throw 대신 상태로 돌려 입력을 유지한다.
 */
export async function updateCalendarEventDetails(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const session = await requireAuth();
  const eventId = formData.get("eventId");
  if (typeof eventId !== "string" || !eventId) {
    return { error: "수정할 일정을 찾을 수 없습니다." };
  }
  const parsed = parseCalendarEventCreateInput({
    title: formData.get("title"),
    eventType: formData.get("eventType"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    description: formData.get("description"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const result = await writeOwnCalendarEventPatch(session.user.id!, eventId, parsed.value);
  if (!result.ok) return { error: result.error };
  return { id: eventId, event: result.value };
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
