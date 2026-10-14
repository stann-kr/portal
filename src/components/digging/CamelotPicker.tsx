"use client";

import { useState } from "react";

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
}

export function CamelotPicker({ value, onChange, readonly = false, disabled = false, "aria-label": ariaLabel = "카멜롯 키" }: CamelotPickerProps) {
  const [open, setOpen] = useState(false);

  if (readonly) {
    return value ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono font-semibold">
        {value}
      </span>
    ) : (
      <span className="text-muted-foreground text-xs">—</span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="w-full text-left rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {value || <span className="text-muted-foreground">키 선택...</span>}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-card border border-border rounded-xl shadow-lg p-3 w-64">
          <div className="grid grid-cols-6 gap-1 mb-2">
            {CAMELOT_KEYS.filter((k) => k.endsWith("A")).map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => { onChange?.(key); setOpen(false); }}
                className={`text-xs py-1 rounded font-mono font-semibold transition-colors ${
                  value === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-accent text-foreground"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-6 gap-1">
            {CAMELOT_KEYS.filter((k) => k.endsWith("B")).map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => { onChange?.(key); setOpen(false); }}
                className={`text-xs py-1 rounded font-mono font-semibold transition-colors ${
                  value === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-accent text-foreground"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          {value && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => { onChange?.(""); setOpen(false); }}
              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground text-center"
            >
              초기화
            </button>
          )}
        </div>
      )}
    </div>
  );
}
