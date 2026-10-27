"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectExternalCalendar,
  disconnectExternalCalendar,
  type ExternalCalendarMutationState,
} from "@/lib/actions/externalCalendars";
import type { ExternalCalendarConnectionSummary } from "@/lib/external-calendar";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/** 공개 레슨 캘린더 연결(캔버스 CalendarDialogs): r10 접는 상자, 48px 머리, 주소 입력과 연결 버튼. */
export function ExternalCalendarConnection({
  connection,
  className,
}: {
  connection: ExternalCalendarConnectionSummary;
  className?: string;
}) {
  const router = useRouter();
  // form action은 결과와 무관하게 uncontrolled 입력을 비우므로, 거부된 주소를 고쳐 다시 시도할 수 있게 값을 제어한다.
  const [url, setUrl] = useState("");
  const [state, formAction, pending] = useActionState<ExternalCalendarMutationState, FormData>(
    async (previous, data) => {
      try {
        const result = await connectExternalCalendar(previous, data);
        if (result.success) setUrl("");
        return result;
      } catch {
        return { error: "연결 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
      }
    },
    {},
  );
  const [disconnecting, startDisconnect] = useTransition();
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.success) return;
    router.refresh();
  }, [router, state.success]);

  return (
    <details className={cn("group rounded-lg border border-border", className)}>
      <summary className="flex h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 text-body font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        공개 레슨 캘린더
        <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          {connection.connected ? (
            <span aria-label={`${connection.label} 연결됨`}>{connection.label} 연결됨</span>
          ) : <span>연결 설정</span>}
          <ChevronDown className="size-3.5 transition-transform duration-[var(--duration-fast)] group-open:rotate-180 motion-reduce:transition-none" strokeWidth={1.6} aria-hidden="true" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-1">
        <p id="external-calendar-help" className="text-ui text-secondary-foreground">
          전용 공개 Google iCal 또는 iCloud 공개 캘린더 주소를 붙여 넣으면 제공자를 자동으로 확인합니다. Google 비공개 Secret iCal 주소는 사용할 수 없습니다.
        </p>

        {connection.connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              pending={disconnecting}
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
              연결 해제
            </Button>
            <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {disconnecting ? "연결을 해제하는 중입니다." : "다른 공개 캘린더로 바꾸려면 아래에서 다시 연결하세요."}
            </span>
          </div>
        ) : null}
        {disconnectError ? (
          <p className="text-xs text-destructive" role="alert" aria-live="assertive" aria-atomic="true">
            {disconnectError}
          </p>
        ) : null}

        <form action={formAction} className="flex gap-2" aria-describedby="external-calendar-help" aria-busy={pending}>
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="external-calendar-url">공개 캘린더 주소</label>
            <Input id="external-calendar-url" name="url" type="url" required aria-required="true" disabled={pending} value={url} onChange={(event) => setUrl(event.target.value)} aria-invalid={Boolean(state.error) && !pending} aria-describedby={state.error ? "external-calendar-help external-calendar-error" : "external-calendar-help"} placeholder="https://…/public/basic.ics" className="font-mono md:text-xs" />
          </div>
          <Button type="submit" className="h-11 shrink-0 rounded-touch px-3.5 md:h-9 md:rounded-md" disabled={pending}>
            {pending ? "확인 중" : connection.connected ? "교체" : "연결"}
          </Button>
        </form>
        {state.error ? <p id="external-calendar-error" className="text-xs text-destructive" role="alert" aria-live="assertive" aria-atomic="true">{state.error}</p> : null}
        {state.success ? <p className="text-xs text-success" role="status" aria-live="polite" aria-atomic="true">{state.success}</p> : null}
      </div>
    </details>
  );
}
