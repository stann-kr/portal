"use client";

import { useState } from "react";
import { Star } from "lucide-react";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}

export function StarRating({ value, onChange, readonly = false, disabled = false, "aria-label": ariaLabel = "별점 평가" }: StarRatingProps) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex gap-0.5" role="radiogroup" aria-label={ariaLabel}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hovered || value);
        return (
          <button
            key={star}
            type="button"
            disabled={readonly || disabled}
            onClick={() => onChange?.(star === value ? 0 : star)}
            onMouseEnter={() => !readonly && !disabled && setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className="disabled:cursor-default"
            aria-label={star === value && onChange ? `${star}점 (다시 누르면 지우기)` : `${star}점`}
            role="radio"
            aria-checked={star === value}
          >
            <Star
              aria-hidden="true"
              className={`w-4 h-4 transition-colors ${
                filled
                  ? "fill-primary text-primary"
                  : "fill-transparent text-muted-foreground/40"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
