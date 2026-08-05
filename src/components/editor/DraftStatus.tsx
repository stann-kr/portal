"use client";

import { AlertCircle, Check, CloudCog, RotateCcw, Trash2 } from "lucide-react";
import type { FormDraftRecoverySummary, FormDraftStatus } from "@/lib/form-draft";

function formatSavedTime(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function DraftStateLine({
  status,
  savedAt,
  restored,
}: {
  status: FormDraftStatus;
  savedAt: Date | null;
  restored: boolean;
}) {
  const time = formatSavedTime(savedAt);

  if (status === "error") {
    return (
      <p role="alert" className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        임시 저장을 사용할 수 없습니다. 직접 저장해 주세요.
      </p>
    );
  }

  if (status === "conflict") {
    return (
      <p role="alert" className="inline-flex items-center gap-1.5 text-xs text-warning">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        다른 작성 흐름을 감지했습니다. 현재 입력은 별도 안전본으로 보관했습니다.
      </p>
    );
  }

  if (status === "saving") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CloudCog className="h-3.5 w-3.5" aria-hidden="true" />
        이 기기에 임시 저장 중…
      </p>
    );
  }

  if (status === "saved") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        {restored ? "저장되지 않은 작성 내용을 복원했습니다" : "이 기기에 임시 저장됨"}
        {time ? <span className="tabular-nums">· {time}</span> : null}
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      작성 중인 내용은 이 기기에 임시 저장됩니다.
    </p>
  );
}

export function DraftStatus({
  status,
  savedAt,
  restored,
  recoveries = [],
  onRestoreRecovery,
  onDiscardRecovery,
  disabled = false,
}: {
  status: FormDraftStatus;
  savedAt: Date | null;
  restored: boolean;
  recoveries?: readonly FormDraftRecoverySummary[];
  onRestoreRecovery?: (storageKey: string) => void;
  onDiscardRecovery?: (storageKey: string) => void;
  disabled?: boolean;
}) {
  const visibleRecoveries = recoveries.slice(0, 5);

  return (
    <div className="space-y-2">
      <DraftStateLine status={status} savedAt={savedAt} restored={restored} />
      {recoveries.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-warning/25 bg-warning-muted px-2.5 py-2">
          <p className="text-xs font-medium text-foreground">
            복구 가능한 작성본 {recoveries.length}개
          </p>
          <ul className="space-y-1">
            {visibleRecoveries.map((recovery) => {
              const recoveryTime = formatSavedTime(recovery.savedAt) ?? "저장 시각 없음";
              return (
                <li key={recovery.storageKey} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-muted-foreground">
                    {recoveryTime} · 이 기기에 최대 30일 보관
                  </span>
                  {onRestoreRecovery ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onRestoreRecovery(recovery.storageKey)}
                      className="inline-flex items-center gap-1 font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${recoveryTime} 충돌 복구본 복원`}
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      복원
                    </button>
                  ) : null}
                  {onDiscardRecovery ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onDiscardRecovery(recovery.storageKey)}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`${recoveryTime} 충돌 복구본 삭제`}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      삭제
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {recoveries.length > visibleRecoveries.length ? (
            <p className="text-xs text-muted-foreground">
              최신 5개를 표시합니다. 나머지 {recoveries.length - visibleRecoveries.length}개도
              보존 기간과 최근 20개 기준 안에서 이 기기에 유지됩니다.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
