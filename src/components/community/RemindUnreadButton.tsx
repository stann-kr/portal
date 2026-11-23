/**
 * @file src/components/community/RemindUnreadButton.tsx
 * @description 안 읽은 학생에게 다시 알리기(캔버스 PushNotices ②). 보낸 뒤 10분 동안은 버튼 대신
 * "다시 알림 보냄 · HH:mm — 10분 뒤 다시 보낼 수 있습니다"를 보이고, 시간이 지나면 버튼으로 돌아온다.
 */
"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { formatKst } from "@/lib/kst-format";

const COOLDOWN_MS = 10 * 60 * 1000;
const CLOCK = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;

type RemindResult = { success: true; sentTo: number; remindedAt: Date } | { success: false; error: string };

export function RemindUnreadButton({
  unreadCount,
  lastRemindedAt,
  remind,
}: {
  unreadCount: number;
  lastRemindedAt: Date | null;
  remind: () => Promise<RemindResult>;
}) {
  const [remindedAt, setRemindedAt] = useState<Date | null>(lastRemindedAt);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const coolingDown = remindedAt !== null && now - remindedAt.getTime() < COOLDOWN_MS;

  useEffect(() => {
    if (!coolingDown || !remindedAt) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remindedAt.getTime() + COOLDOWN_MS - Date.now() + 50);
    return () => window.clearTimeout(timer);
  }, [coolingDown, remindedAt]);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await remind();
        if (!result.success) {
          setError(result.error);
          return;
        }
        setRemindedAt(result.remindedAt);
        setNow(Date.now());
        setNotice(`${result.sentTo}명에게 다시 알렸습니다.`);
      } catch {
        setError("다시 알리지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {coolingDown && remindedAt ? (
        <p className="text-ui text-secondary-foreground">
          다시 알림 보냄 · <span className="font-mono">{formatKst(remindedAt, CLOCK)}</span>
          <span className="text-muted-foreground"> — 10분 뒤 다시 보낼 수 있습니다</span>
        </p>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11 gap-1.5 self-start rounded-touch px-3 md:h-8 md:rounded-md"
          onClick={handleClick}
          disabled={isPending}
          aria-busy={isPending || undefined}
        >
          {isPending ? <ButtonSpinner /> : <Bell className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
          안 읽은 {unreadCount}명에게 다시 알리기
        </Button>
      )}
      <p role="status" className="sr-only">{notice}</p>
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
    </div>
  );
}
