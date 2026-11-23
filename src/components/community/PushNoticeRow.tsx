/**
 * @file src/components/community/PushNoticeRow.tsx
 * @description 공지 목록 안 글 없는 알림 줄(캔버스 PushNotices ②). 종 아이콘·내용·"읽음 3/7" 한 줄을 누르면
 * 그 자리에 펼쳐 내용 전문, 읽은 학생(시각), 아직 안 읽은 학생(알림 꺼짐), 다시 알리기·지우기를 보인다. 관리자만 본다.
 */
"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Bell, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import {
  deletePushNotice,
  getPushNoticeSummary,
  remindPushNotice,
  type PushNoticeRow as PushNoticeRowData,
  type PushNoticeSummary,
} from "@/lib/actions/pushNotices";
import { formatKst, formatKstShortDate } from "@/lib/kst-format";
import { cn } from "@/lib/utils";
import { ReadersPanel } from "./PostReaders";
import { RemindUnreadButton } from "./RemindUnreadButton";

const CLOCK = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;

export function PushNoticeRow({ notice, onChanged }: { notice: PushNoticeRowData; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<PushNoticeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const deleteConfirm = useConfirmAction();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getPushNoticeSummary(notice.id)
      .then((result) => {
        if (cancelled) return;
        if (result) setSummary(result);
        else setError("알림을 찾지 못했습니다. 이미 지워졌을 수 있습니다.");
      })
      .catch(() => { if (!cancelled) setError("읽음 정보를 읽지 못했습니다."); });
    return () => { cancelled = true; };
  }, [open, notice.id]);

  const remove = () => {
    startDelete(async () => {
      try {
        const result = await deletePushNotice(notice.id);
        if (!result.success) {
          setError(result.error);
          return;
        }
        onChanged();
      } catch {
        setError("지우지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const meta = `Stann · ${formatKstShortDate(notice.createdAt)}`;
  const unread = summary?.unread ?? [];

  return (
    <li className="flex flex-col border-b border-muted">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-start gap-2.5 py-3 text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:h-14 md:items-center md:px-1 md:py-0"
      >
        <Bell role="img" aria-label="알림" className="mt-1 size-3.5 shrink-0 text-muted-foreground md:mt-0" strokeWidth={1.6} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-2.5">
          <span className={cn("text-md md:min-w-0 md:flex-1", open ? "whitespace-pre-line break-words font-medium" : "md:truncate")}>
            {notice.body}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {meta} · 읽음 <span className="font-mono">{notice.readCount}/{notice.recipientCount}</span>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none md:mt-0", open && "rotate-180")}
          strokeWidth={1.8}
        />
      </button>
      {open ? (
        <div id={panelId} className="flex flex-col gap-3.5 pb-4 pl-6 md:px-1 md:pl-7">
          <p className="text-xs text-muted-foreground">
            Stann · {formatKstShortDate(notice.createdAt)} {formatKst(notice.createdAt, CLOCK)} · 받는 사람 {notice.recipientCount}명
          </p>
          {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
          {summary ? (
            <ReadersPanel
              readers={summary.readers.map((reader) => ({ id: reader.id, name: reader.name, at: reader.readAt }))}
              unread={unread}
              actions={(
                <div className="flex flex-wrap items-start gap-2">
                  {unread.length > 0 ? (
                    <RemindUnreadButton
                      unreadCount={unread.length}
                      lastRemindedAt={summary.lastRemindedAt}
                      remind={() => remindPushNotice(notice.id)}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 rounded-touch px-2.5 text-ui text-secondary-foreground md:h-8 md:rounded-md"
                    aria-expanded={deleteConfirm.isOpen}
                    onClick={(event) => deleteConfirm.request(event.currentTarget)}
                    disabled={isDeleting}
                  >
                    지우기
                  </Button>
                </div>
              )}
              footnote={unread.some((student) => student.pushOff)
                ? "알림을 열거나 홈에서 “확인”을 누른 시각입니다. 알림 꺼짐은 받을 기기가 없거나 공지 알림을 끈 학생입니다."
                : "알림을 열거나 홈에서 “확인”을 누른 시각입니다."}
            />
          ) : !error ? (
            <p role="status" className="text-ui text-muted-foreground">읽음 정보를 불러오는 중...</p>
          ) : null}
          {deleteConfirm.isOpen ? (
            <ConfirmPanel
              confirm={deleteConfirm}
              message="이 알림을 지울까요? 학생 홈의 알림 카드도 함께 사라집니다. 이미 받은 휴대폰 알림은 그대로 남습니다."
              confirmLabel="지우기"
              pendingLabel="지우는 중..."
              pending={isDeleting}
              onConfirm={remove}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
