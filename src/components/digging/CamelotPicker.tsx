"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// 카멜롯 휠 24개 키
const CAMELOT_KEYS = [
  "1A","2A","3A","4A","5A","6A","7A","8A","9A","10A","11A","12A",
  "1B","2B","3B","4B","5B","6B","7B","8B","9B","10B","11B","12B",
];

interface CamelotPickerProps {
  value: string;
  onChange?: (value: string) => void;
  readonly?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  /** table: 디깅 표 칸(테두리 없이 글자처럼), field: 카드·대화상자 입력 */
  variant?: "table" | "field";
}

/** 카멜롯 키 선택. 열린 키판은 Esc나 바깥 누르기로 닫고, 닫히면 키 버튼으로 초점이 돌아간다. */
export function CamelotPicker({
  value,
  onChange,
  readonly = false,
  disabled = false,
  "aria-label": ariaLabel = "카멜롯 키",
  variant = "field",
}: CamelotPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (readonly) {
    return value ? (
      <span className="font-mono text-ui text-foreground">{value}</span>
    ) : (
      <span className="text-ui text-muted-foreground">미입력</span>
    );
  }

  const choose = (key: string) => {
    onChange?.(key);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const keyButton = (key: string) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      aria-pressed={value === key}
      onClick={() => choose(key)}
      className={cn(
        "h-8 rounded-sm font-mono text-xs font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        value === key ? "bg-accent text-accent-foreground" : "bg-muted text-foreground hover:bg-selected",
      )}
    >
      {key}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          variant === "table"
            ? "h-11 rounded-sm px-1 font-mono text-ui hover:bg-sidebar"
            : "h-11 rounded-touch border border-input bg-background px-3 font-mono text-base md:h-9 md:rounded-md md:text-sm",
        )}
      >
        {value || <span className={cn("font-sans", variant === "table" ? "text-faint" : "text-muted-foreground")}>키 선택</span>}
      </button>

      {open && (
        <div
          role="group"
          aria-label={`${ariaLabel} 고르기`}
          className="absolute left-0 top-full mt-1 flex w-64 flex-col gap-1 rounded-lg border border-border bg-background p-3 shadow-floating"
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          <div className="grid grid-cols-6 gap-1">
            {CAMELOT_KEYS.filter((k) => k.endsWith("A")).map(keyButton)}
          </div>
          <div className="grid grid-cols-6 gap-1">
            {CAMELOT_KEYS.filter((k) => k.endsWith("B")).map(keyButton)}
          </div>
          {value && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => choose("")}
              className="mt-1 h-8 rounded-md text-ui text-secondary-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              초기화
            </button>
          )}
        </div>
      )}
    </div>
  );
}
