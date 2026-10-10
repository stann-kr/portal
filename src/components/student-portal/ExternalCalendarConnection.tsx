"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectExternalCalendar,
  disconnectExternalCalendar,
  type ExternalCalendarMutationState,
} from "@/lib/actions/externalCalendars";
import type { ExternalCalendarConnectionSummary } from "@/lib/external-calendar";
import { useRouter } from "next/navigation";

export function ExternalCalendarConnection({ connection }: { connection: ExternalCalendarConnectionSummary }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ExternalCalendarMutationState, FormData>(connectExternalCalendar, {});
  const [disconnecting, startDisconnect] = useTransition();
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.success]);

  return (
    <details className="group shrink-0 border-b border-border px-3 sm:px-6">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-foreground">공개 레슨 캘린더</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {connection.connected ? (
            <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground" aria-label={`${connection.label} 연결됨`}>
              {connection.label} 연결됨
            </span>
          ) : <span>연결 설정</span>}
          <ChevronDown className="size-4 transition-transform duration-[var(--duration-fast)] group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </span>
      </summary>
      <div className="pb-3">
        <p id="external-calendar-help" className="text-xs text-muted-foreground">
          전용 공개 Google iCal 또는 iCloud 공개 캘린더만 연결하세요. Google 비공개 Secret iCal 주소는 사용할 수 없습니다.
        </p>

        {connection.connected ? (
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disconnecting}
              onClick={() => startDisconnect(async () => {
                setDisconnectError(null);
                try {
                  await disconnectExternalCalendar();
                  router.refresh();
                } catch {
                  setDisconnectError("공개 레슨 캘린더를 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
                }
              })}
            >
              <Unlink className="size-3.5" aria-hidden="true" />
              연결 해제
            </Button>
            <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {disconnecting ? "연결을 해제하는 중입니다." : "다른 공개 캘린더로 바꾸려면 아래에서 다시 연결하세요."}
            </span>
          </div>
        ) : null}
        {disconnectError ? (
          <p className="mt-2 text-xs text-destructive" role="alert" aria-live="assertive" aria-atomic="true">
            {disconnectError}
          </p>
        ) : null}

        <form ref={formRef} action={formAction} className="mt-3 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]" aria-describedby="external-calendar-help" aria-busy={pending}>
          <label className="sr-only" htmlFor="external-calendar-provider">캘린더 제공자</label>
          <select id="external-calendar-provider" name="provider" defaultValue={connection.provider ?? "GOOGLE"} className="h-9 rounded-md border border-input bg-background px-3 text-sm" disabled={pending}>
            <option value="GOOGLE">Google Calendar</option>
            <option value="ICLOUD">iCloud Calendar</option>
          </select>
          <div>
            <label className="sr-only" htmlFor="external-calendar-url">공개 iCal 주소</label>
            <Input id="external-calendar-url" name="url" type="url" required aria-required="true" disabled={pending} aria-invalid={Boolean(state.error)} aria-describedby={state.error ? "external-calendar-help external-calendar-error" : "external-calendar-help"} placeholder="https://…/public/basic.ics 또는 https://p…-caldav.icloud.com/published/2/…" />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <Link2 className="size-3.5" aria-hidden="true" />
            {pending ? "확인 중" : connection.connected ? "교체" : "연결"}
          </Button>
        </form>
        {state.error ? <p id="external-calendar-error" className="mt-2 text-xs text-destructive" role="alert" aria-live="assertive" aria-atomic="true">{state.error}</p> : null}
        {state.success ? <p className="mt-2 text-xs text-success" role="status" aria-live="polite" aria-atomic="true">{state.success}</p> : null}
      </div>
    </details>
  );
}
