/**
 * @file src/components/student-portal/today/PushNoticeCards.tsx
 * @description 학생 홈 맨 위의 아직 확인하지 않은 Stann의 알림(캔버스 PushNotices ③). "확인"을 누르면 읽음이 되고 카드가 사라진다.
 * 휴대폰 알림을 눌러 `?notice=<id>`로 열리면 그 알림을 바로 읽음으로 남기고 카드는 "확인됨"으로 보인 뒤,
 * 주소의 notice는 replaceState로 지운다(새로고침해도 다시 읽음 처리하지 않게). 확인한 알림을 다시 볼 목록은 두지 않는다.
 */
"use client";

import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markPushNoticeRead, type StudentPushNotice } from "@/lib/actions/pushNotices";
import { formatKstDot } from "@/lib/kst-format";

/** "확인됨"을 보인 뒤 카드를 걷는 시간. */
const CONFIRMED_VISIBLE_MS = 2500;

export function PushNoticeCards({
  notices,
  openedNoticeId = null,
}: {
  notices: StudentPushNotice[];
  /** 휴대폰 알림을 눌러 연 알림(?notice=). 서버가 주소에서 읽어 넘긴다. */
  openedNoticeId?: string | null;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  // 알림을 눌러 열었으면 읽음으로 남기고(여러 번 불러도 처음 한 번만 남는다) 주소에서 지운 뒤 잠시 뒤 카드를 걷는다.
  useEffect(() => {
    if (!openedNoticeId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("notice")) {
      url.searchParams.delete("notice");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void markPushNoticeRead(openedNoticeId).catch(() => undefined);
    const timer = window.setTimeout(() => {
      setDismissed((current) => new Set(current).add(openedNoticeId));
    }, CONFIRMED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [openedNoticeId]);

  const visible = notices.filter((notice) => !dismissed.has(notice.id));
  if (visible.length === 0) return null;

  const acknowledge = (noticeId: string) => {
    // 누르는 즉시 걷는다. 저장이 실패해도 다음 방문 때 다시 보이므로 따로 알리지 않는다.
    setDismissed((current) => new Set(current).add(noticeId));
    void markPushNoticeRead(noticeId).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-2.5 md:gap-3">
      {visible.map((notice) => {
        const isConfirmed = notice.id === openedNoticeId;
        return (
          <section
            key={notice.id}
            aria-label="Stann의 알림"
            className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-sidebar px-4 py-3.5 md:flex-row md:items-center md:gap-4 md:px-5 md:py-4"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 md:gap-1.5">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Bell className="size-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
                <span>
                  Stann의 알림 · <span className="font-mono">{formatKstDot(notice.createdAt, { time: true })}</span>
                </span>
              </p>
              <p className="whitespace-pre-line break-words text-md text-foreground">{notice.body}</p>
            </div>
            {isConfirmed ? (
              <p role="status" className="flex h-11 items-center gap-1.5 self-end text-ui text-secondary-foreground md:h-9 md:self-auto">
                <Check className="size-3.5" strokeWidth={1.8} aria-hidden="true" />확인됨
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-11 self-end rounded-touch px-4 text-ui font-medium md:h-9 md:self-auto md:rounded-md"
                onClick={() => acknowledge(notice.id)}
              >
                확인<span className="sr-only">: {notice.body}</span>
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}
