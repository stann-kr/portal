/**
 * @file src/app/dashboard/calendar/page.tsx
 * @description 개인 캘린더 페이지 — Phase 4.
 * FullCalendar 기반 월간/주간/일간/목록 뷰 + 드래그&드롭 일정 관리.
 * 이벤트 유형은 공통 semantic event token으로 표현한다.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { createDb } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { CalendarDays, Plus } from "lucide-react";
import { PersonalCalendar } from "@/components/calendar/PersonalCalendar";

export default async function CalendarPage() {
  const session = await getActiveAuthSession();
  if (!session?.user) redirect("/login");

  const db = createDb();
  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.userId, session.user.id!));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary" />
            내 캘린더
          </h1>
          <p className="text-sm text-muted-foreground">
            날짜를 클릭하면 새 일정을 추가할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-3 py-2">
          <Plus className="w-3.5 h-3.5" />
          날짜 클릭으로 추가
        </div>
      </div>

      {/* FullCalendar */}
      <div className="border border-border rounded-2xl bg-card p-4 shadow-sm">
        <PersonalCalendar initialEvents={events} />
      </div>
    </div>
  );
}
