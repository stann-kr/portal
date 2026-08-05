"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

type CreationConflictActionsProps = {
  existingHref?: string;
  onOpenExisting?: () => void;
  existingLabel: string;
  separateLabel: string;
  onSeparate: () => void;
  disabled?: boolean;
};

/** 같은 생성 초안이 다른 내용으로 먼저 처리됐을 때 사용자의 다음 선택을 명시한다. */
export function CreationConflictActions({
  existingHref,
  onOpenExisting,
  existingLabel,
  separateLabel,
  onSeparate,
  disabled = false,
}: CreationConflictActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {existingHref ? (
        <Button asChild size="sm" variant="outline">
          <Link
            href={existingHref}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            className={disabled ? "pointer-events-none opacity-50" : undefined}
            onClick={(event) => {
              if (disabled) event.preventDefault();
            }}
          >
            {existingLabel}
          </Link>
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onOpenExisting}
          disabled={disabled || !onOpenExisting}
        >
          {existingLabel}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onSeparate}
        disabled={disabled}
      >
        {separateLabel}
      </Button>
    </div>
  );
}
