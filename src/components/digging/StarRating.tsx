"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  /** sm: 디깅 표 칸(별 14px), md: 대화상자(별 16px, 높이 44), touch: 좁은 화면 카드(별 18px, 누르는 곳 44×44) */
  size?: "sm" | "md" | "touch";
}

/**
 * 1–5점 별점. 고르는 화면은 radio 묶음(같은 별을 다시 누르면 지움), 읽기 화면은 "별점 N점" 그림 하나로 읽힌다.
 * 채운 별은 글자색, 빈 별은 장식 회색(faint)이다.
 */
export function StarRating({
  value,
  onChange,
  readonly = false,
  disabled = false,
  "aria-label": ariaLabel = "별점 평가",
  size = "md",
}: StarRatingProps) {
  const [hovered, setHovered] = useState(0);
  const iconClass = size === "sm" ? "size-3.5" : size === "touch" ? "size-[18px]" : "size-4";

  if (readonly) {
    return (
      <span
        role="img"
        aria-label={value > 0 ? `${ariaLabel} ${value}점` : `${ariaLabel} 미입력`}
        className="inline-flex items-center gap-0.5"
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            aria-hidden="true"
            strokeWidth={1.6}
            className={cn(iconClass, star <= value ? "fill-foreground text-foreground" : "fill-faint text-faint")}
          />
        ))}
      </span>
    );
  }

  return (
    <div className="flex" role="radiogroup" aria-label={ariaLabel}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hovered || value);
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(star === value ? 0 : star)}
            onMouseEnter={() => !disabled && setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className={cn(
              "flex h-11 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
              size === "sm" ? "w-[18px]" : size === "touch" ? "w-11" : "w-7",
            )}
            aria-label={star === value && onChange ? `${star}점 (다시 누르면 지우기)` : `${star}점`}
            role="radio"
            aria-checked={star === value}
          >
            <Star
              aria-hidden="true"
              strokeWidth={1.6}
              className={cn(
                iconClass,
                "transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none",
                filled ? "fill-foreground text-foreground" : "fill-faint text-faint",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
