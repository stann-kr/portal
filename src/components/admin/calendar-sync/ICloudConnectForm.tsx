"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectICloudCalendar, type CalendarSyncFormState } from "@/lib/actions/calendarSync";
import { cn } from "@/lib/utils";
import { FeedbackMessages, feedbackErrorId } from "./FeedbackMessages";
import { ACTION_BUTTON_CLASS, CALENDAR_SYNC_MESSAGES, FIELD_LABEL_CLASS } from "./calendar-sync-ui";

/**
 * iCloud 계정 연결: Apple ID와 앱 전용 암호. 암호는 제출 직후 입력란에서 지우고 다시 보여 주지 않는다.
 */
export function ICloudConnectForm({ disabled, describedBy }: { disabled: boolean; describedBy?: string }) {
  const router = useRouter();
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [state, formAction, pending] = useActionState<CalendarSyncFormState, FormData>(
    async (previous, data) => {
      // FormData가 값을 이미 담았으므로 결과와 무관하게 화면의 암호는 바로 지운다.
      setAppPassword("");
      try {
        const result = await connectICloudCalendar(previous, data);
        if (result.success) setAppleId("");
        return result;
      } catch {
        return { error: CALENDAR_SYNC_MESSAGES.unexpected };
      }
    },
    {},
  );

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state]);

  const helpId = "icloud-connect-help";
  const resultId = "icloud-connect-result";

  return (
    <form action={formAction} aria-labelledby="icloud-connect-heading" className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-0.5">
        <h3 id="icloud-connect-heading" className="text-body font-medium text-foreground">iCloud 캘린더</h3>
        <p id={helpId} className="text-ui text-muted-foreground md:text-xs">
          Apple ID 암호 대신 앱 전용 암호를 씁니다.{" "}
          <a
            href="https://appleid.apple.com"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            appleid.apple.com
          </a>
          에 로그인해 로그인 및 보안 → 앱 전용 암호에서 새 암호를 만든 뒤 붙여 넣어 주세요. 암호는 암호화해 저장하고 다시 보여 주지 않습니다.
        </p>
      </div>
      <fieldset disabled={disabled || pending} aria-describedby={describedBy} className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="icloud-apple-id" className={FIELD_LABEL_CLASS}>Apple ID</label>
          <Input
            id="icloud-apple-id"
            name="appleId"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={appleId}
            onChange={(event) => setAppleId(event.target.value)}
            aria-describedby={helpId}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="icloud-app-password" className={FIELD_LABEL_CLASS}>앱 전용 암호</label>
          <Input
            id="icloud-app-password"
            name="appPassword"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={appPassword}
            onChange={(event) => setAppPassword(event.target.value)}
            aria-describedby={`${helpId}${state.error ? ` ${feedbackErrorId(resultId)}` : ""}`}
            aria-invalid={state.error ? true : undefined}
          />
        </div>
        <Button type="submit" pending={pending} className={cn(ACTION_BUTTON_CLASS, "w-full md:w-auto")}>
          {pending ? "연결 확인 중" : "iCloud 연결"}
        </Button>
      </fieldset>
      <FeedbackMessages id={resultId} error={state.error} success={state.success} />
    </form>
  );
}
