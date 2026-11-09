"use client";

import { cn } from "@/lib/utils";

/** 알림 설정의 켜기·끄기 스위치(캔버스 NotificationSettings: 넓은 화면 36×20, 휴대폰 44×26). */
export function PushSwitch({
  checked,
  labelledBy,
  describedBy,
  disabled,
  onChange,
}: {
  checked: boolean;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-[26px] w-11 shrink-0 rounded-full p-[3px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none md:h-5 md:w-9 md:p-0.5",
        checked ? "justify-end bg-primary" : "justify-start bg-switch-off",
      )}
    >
      <span aria-hidden="true" className="size-5 rounded-full bg-background md:size-4" />
    </button>
  );
}
