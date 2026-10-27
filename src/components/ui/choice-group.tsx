/**
 * @file src/components/ui/choice-group.tsx
 * @description 하나만 고르는 선택 줄(캔버스 CommunityNew의 게시판 유형 세그먼트·채널 칩).
 * radiogroup 키보드 규칙: 선택된 항목만 Tab으로 들어오고, 화살표·Home·End가 선택과 초점을 함께 옮긴다.
 */
"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type ChoiceOption<T extends string> = { value: T; label: string };

export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  variant,
  disabled = false,
}: {
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T | string;
  onChange: (value: T) => void;
  /** segment: 채움 면 위의 세그먼트(게시판 유형), chips: 둥근 칩(채널) */
  variant: "segment" | "chips";
  disabled?: boolean;
}) {
  const labelId = useId();
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index === last ? 0 : index + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index === 0 ? last : index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-body font-medium text-secondary-foreground md:text-ui">{label}</span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={cn(
          variant === "segment"
            ? "inline-flex h-11 gap-0.5 self-start rounded-touch bg-muted p-0.5 md:h-8 md:rounded-md"
            : "flex flex-wrap gap-1.5",
        )}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                buttonsRef.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === focusableIndex ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                if (!checked) onChange(option.value);
              }}
              onKeyDown={(event) => move(event, index)}
              className={cn(
                "whitespace-nowrap transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:opacity-50",
                variant === "segment"
                  ? cn(
                    "h-10 rounded-md px-4 text-body md:h-7 md:rounded-sm md:px-3.5 md:text-ui",
                    checked ? "bg-background font-medium text-foreground shadow-segment" : "text-secondary-foreground hover:text-foreground",
                  )
                  : cn(
                    "h-11 rounded-full px-3.5 text-ui md:h-[30px] md:px-3 md:text-xs",
                    checked ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-foreground hover:text-foreground",
                  ),
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
