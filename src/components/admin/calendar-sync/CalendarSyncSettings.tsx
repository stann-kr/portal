"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import type { CalendarSyncOverview } from "@/lib/actions/calendarSync";
import { googleOAuthResultMessage, type GoogleOAuthResult } from "@/lib/calendar-sync/google-oauth-result";
import { cn } from "@/lib/utils";
import { ConnectionCard } from "./ConnectionCard";
import { ICloudConnectForm } from "./ICloudConnectForm";
import { ACTION_BUTTON_CLASS, CALENDAR_SYNC_MESSAGES, GOOGLE_CONNECT_HREF, NOTICE_CLASS } from "./calendar-sync-ui";

/**
 * 관리자 캘린더 동기화 설정: 서버 설정 안내, Google·iCloud 계정 연결, 연결별 학생 캘린더 매핑.
 * 화면 데이터는 server page가 읽고, 변경 뒤에는 router.refresh로 다시 받는다.
 */
export function CalendarSyncSettings({
  overview,
  result,
}: {
  overview: CalendarSyncOverview;
  result: GoogleOAuthResult | null;
}) {
  const { availability, connections, students } = overview;
  const encryptionNoticeId = useId();
  const googleNoticeId = useId();
  const [banner, setBanner] = useState(result);
  const googleEnabled = availability.encryptionConfigured && availability.googleConfigured;
  const googleOffReason = [
    !availability.encryptionConfigured ? encryptionNoticeId : null,
    !availability.googleConfigured ? googleNoticeId : null,
  ].filter(Boolean).join(" ");

  useEffect(() => {
    // callback 결과는 한 번만 보이고, 새로고침·공유 주소에는 남기지 않는다.
    const url = new URL(window.location.href);
    if (!url.searchParams.has("google") && !url.searchParams.has("message")) return;
    url.searchParams.delete("google");
    url.searchParams.delete("message");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {banner ? (
        <div
          role={banner.kind === "connected" ? "status" : "alert"}
          className={cn(
            "flex items-start justify-between gap-2 rounded-touch py-1.5 pl-3.5 pr-1.5",
            banner.kind === "connected" ? "bg-success-muted text-foreground" : "bg-destructive-muted text-destructive",
          )}
        >
          <p className="min-w-0 py-1 text-body md:text-ui">{googleOAuthResultMessage(banner)}</p>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => setBanner(null)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-secondary-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-7"
          >
            <X className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {!availability.encryptionConfigured || !availability.googleConfigured ? (
        <div className="flex flex-col gap-2">
          {!availability.encryptionConfigured ? (
            <p id={encryptionNoticeId} className={cn(NOTICE_CLASS, "border-warning-border bg-warning-muted text-foreground")}>
              {CALENDAR_SYNC_MESSAGES.encryptionMissing}
            </p>
          ) : null}
          {!availability.googleConfigured ? (
            <p id={googleNoticeId} className={cn(NOTICE_CLASS, "border-warning-border bg-warning-muted text-foreground")}>
              {CALENDAR_SYNC_MESSAGES.googleMissing}
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="calendar-sync-connect-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="calendar-sync-connect-heading" className="text-md font-semibold text-foreground">계정 연결</h2>
          <p className="text-body text-secondary-foreground md:text-ui">
            선생님 계정의 공유 캘린더를 연결하면 학생별로 고른 캘린더와 포탈 레슨·일정을 양쪽으로 맞춥니다.
          </p>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h3 className="text-body font-medium text-foreground">Google 캘린더</h3>
              <p className="text-ui text-muted-foreground md:text-xs">Google 로그인 화면에서 캘린더 접근을 허용하면 이 화면으로 돌아옵니다.</p>
            </div>
            {googleEnabled ? (
              <a href={GOOGLE_CONNECT_HREF} className={buttonClassName({ className: cn(ACTION_BUTTON_CLASS, "w-full md:w-auto") })}>
                Google 계정 연결
              </a>
            ) : (
              <Button type="button" disabled aria-describedby={googleOffReason || undefined} className={cn(ACTION_BUTTON_CLASS, "w-full md:w-auto")}>
                Google 계정 연결
              </Button>
            )}
          </div>
        </div>
        <ICloudConnectForm
          disabled={!availability.encryptionConfigured}
          describedBy={!availability.encryptionConfigured ? encryptionNoticeId : undefined}
        />
      </section>

      <section aria-labelledby="calendar-sync-connections-heading" className="flex flex-col gap-4">
        <h2 id="calendar-sync-connections-heading" className="text-md font-semibold text-foreground">연결된 계정</h2>
        {connections.length === 0 ? (
          <p className="border-t border-border pt-4 text-body text-muted-foreground md:text-ui">아직 연결한 캘린더 계정이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                students={students}
                googleReconnectEnabled={googleEnabled}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
