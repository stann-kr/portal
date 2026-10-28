"use client";

import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        <Link
          href={existingHref}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          className={cn(buttonClassName({ variant: "outline" }), disabled && "pointer-events-none opacity-50")}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          {existingLabel}
        </Link>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={onOpenExisting}
          disabled={disabled || !onOpenExisting}
        >
          {existingLabel}
        </Button>
      )}
      <Button type="button" onClick={onSeparate} disabled={disabled}>
        {separateLabel}
      </Button>
    </div>
  );
}
