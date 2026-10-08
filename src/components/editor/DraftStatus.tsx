"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Check, CloudCog, RotateCcw, Trash2 } from "lucide-react";
import { ServerDraftStatus } from "@/components/editor/ServerDraftStatus";
import type { FormDraftRecoverySummary, FormDraftStatus } from "@/lib/form-draft";
import type { DocumentServerDraftSyncResult } from "@/lib/hooks/useDocumentServerDraftSync";
import { formatKst } from "@/lib/kst-format";

function formatSavedTime(value: Date | null): string | null {
  return formatKst(value, { hour: "2-digit", minute: "2-digit" }) || null;
}

function formatRecoveryDateTime(value: Date): string | null {
  return formatKst(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) || null;
}

function DraftStateLine({
  status,
  canSubmit,
  savedAt,
  restored,
}: {
  status: FormDraftStatus;
  canSubmit: boolean;
  savedAt: Date | null;
  restored: boolean;
}) {
  const time = formatSavedTime(savedAt);

  if (status === "error") {
    return (
      <p role="alert" className="inline-flex items-start gap-1.5 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {canSubmit
            ? "이 기기에 임시 저장할 수 없습니다. 입력 내용을 복사해 보관하거나 화면의 저장 버튼으로 직접 저장해 주세요."
            : "임시 저장 중 오류가 발생했습니다. 더 최신 앱 버전에서 만든 이 기기 초안을 보호하기 위해 이 화면에서는 제출할 수 없습니다. 새로 입력한 내용을 복사해 보관한 뒤 최신 앱으로 새로고침하거나 새 탭에서 열어 주세요."}
        </span>
      </p>
    );
  }

  if (status === "incompatible") {
    return (
      <p
        role="alert"
        className="inline-flex items-start gap-1.5 text-xs text-warning"
      >
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          더 최신 앱 버전에서 만든 이 기기 초안이 있어 덮어쓰지 않았습니다.
          최신 앱으로 새로고침하거나 새 탭에서 열어 주세요. 중복 저장을 막기
          위해 이 화면에서는 제출할 수 없으며, 새로 입력한 내용은 별도
          복구본으로 보관됩니다.
        </span>
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

function DraftRecoveryItem({
  recovery,
  onRestoreRecovery,
  onDiscardRecovery,
  onMoveFocusBeforeDiscard,
  disabled,
}: {
  recovery: FormDraftRecoverySummary;
  onRestoreRecovery?: (storageKey: string) => void;
  onDiscardRecovery?: (storageKey: string) => void;
  onMoveFocusBeforeDiscard: () => void;
  disabled: boolean;
}) {
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const confirmationId = useId();
  const discardTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocusRef = useRef(false);
  const recoveryTime =
    formatRecoveryDateTime(recovery.savedAt) ?? "저장 시각 없음";
  const recoveryIsoTime = Number.isFinite(recovery.savedAt.getTime())
    ? recovery.savedAt.toISOString()
    : undefined;
  const recoveryDescription =
    recovery.preview.title ?? recovery.preview.body ?? "내용 미리보기 없음";
  const recoveryAccessibleName = `${recoveryTime} · ${recoveryDescription}`;

  useEffect(() => {
    if (isConfirmingDiscard) {
      cancelButtonRef.current?.focus();
      return;
    }
    if (restoreTriggerFocusRef.current) {
      restoreTriggerFocusRef.current = false;
      discardTriggerRef.current?.focus();
    }
  }, [isConfirmingDiscard]);

  const cancelDiscard = () => {
    restoreTriggerFocusRef.current = true;
    setIsConfirmingDiscard(false);
  };

  const confirmDiscard = () => {
    restoreTriggerFocusRef.current = false;
    onMoveFocusBeforeDiscard();
    setIsConfirmingDiscard(false);
    onDiscardRecovery?.(recovery.storageKey);
  };

  return (
    <li className="space-y-2 rounded-md border border-warning/20 bg-background/70 p-2 text-xs">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <time
            dateTime={recoveryIsoTime}
            className="tabular-nums text-muted-foreground"
          >
            {recoveryTime} · 이 기기에 최대 30일 보관
          </time>
          {recovery.isCurrent ? (
            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 font-medium text-foreground">
              현재 화면본
            </span>
          ) : null}
        </div>
        {recovery.preview.title ? (
          <p className="break-words text-foreground">
            <span className="font-medium">제목</span>
            <span aria-hidden="true"> · </span>
            {recovery.preview.title}
          </p>
        ) : null}
        {recovery.preview.body ? (
          <p className="break-words text-muted-foreground">
            <span className="font-medium text-foreground">본문</span>
            <span aria-hidden="true"> · </span>
            {recovery.preview.body}
          </p>
        ) : null}
        {!recovery.preview.title && !recovery.preview.body ? (
          <p className="text-muted-foreground">내용 미리보기가 없습니다.</p>
        ) : null}
      </div>

      {isConfirmingDiscard ? (
        <div
          role="group"
          aria-labelledby={confirmationId}
          className="space-y-2 rounded-md border border-destructive/25 bg-destructive/10 p-2"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancelDiscard();
          }}
        >
          <p id={confirmationId} role="alert" className="text-destructive">
            {recovery.isCurrent
              ? "현재 화면에 보이는 복구본을 삭제하면 다른 작성본으로 바뀔 수 있고 되돌릴 수 없습니다. 삭제할까요?"
              : "이 복구본을 삭제하면 되돌릴 수 없습니다. 삭제할까요?"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={cancelButtonRef}
              type="button"
              disabled={disabled}
              onClick={cancelDiscard}
              className="font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={confirmDiscard}
              className="font-medium text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              aria-describedby={confirmationId}
              aria-label={`${recoveryAccessibleName} 복구본 삭제 확인`}
            >
              삭제 확인
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {onRestoreRecovery ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRestoreRecovery(recovery.storageKey)}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`${recoveryAccessibleName} 충돌 복구본 복원`}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              복원
            </button>
          ) : null}
          {onDiscardRecovery ? (
            <button
              ref={discardTriggerRef}
              type="button"
              disabled={disabled}
              onClick={() => setIsConfirmingDiscard(true)}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`${recoveryAccessibleName} 충돌 복구본 삭제 확인 열기`}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              삭제
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function DraftStatus({
  status,
  canSubmit,
  savedAt,
  restored,
  recoveries = [],
  onRestoreRecovery,
  onDiscardRecovery,
  serverSync,
  disabled = false,
}: {
  status: FormDraftStatus;
  /** 미래 버전 canonical 보호를 포함해 현재 서버 제출이 허용되는지 여부 */
  canSubmit: boolean;
  savedAt: Date | null;
  restored: boolean;
  recoveries?: readonly FormDraftRecoverySummary[];
  onRestoreRecovery?: (storageKey: string) => void;
  onDiscardRecovery?: (storageKey: string) => void;
  serverSync?: DocumentServerDraftSyncResult;
  disabled?: boolean;
}) {
  const [showAllRecoveries, setShowAllRecoveries] = useState(false);
  const recoveryListId = useId();
  const stableFocusTargetRef = useRef<HTMLDivElement>(null);
  const hasHiddenRecoveries = recoveries.length > 5;
  const visibleRecoveries = showAllRecoveries
    ? recoveries
    : recoveries.slice(0, 5);

  return (
    <div
      ref={stableFocusTargetRef}
      role="group"
      aria-label="임시 저장 상태"
      tabIndex={-1}
      className="space-y-2"
    >
      <DraftStateLine
        status={status}
        canSubmit={canSubmit}
        savedAt={savedAt}
        restored={restored}
      />
      {serverSync ? <ServerDraftStatus sync={serverSync} disabled={disabled} /> : null}
      {recoveries.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-warning/25 bg-warning-muted px-2.5 py-2">
          <p
            role="status"
            aria-live="polite"
            className="text-xs font-medium text-foreground"
          >
            복구 가능한 작성본 {recoveries.length}개
          </p>
          <ul id={recoveryListId} className="space-y-2">
            {visibleRecoveries.map((recovery) => (
              <DraftRecoveryItem
                key={recovery.storageKey}
                recovery={recovery}
                onRestoreRecovery={onRestoreRecovery}
                onDiscardRecovery={onDiscardRecovery}
                onMoveFocusBeforeDiscard={() => stableFocusTargetRef.current?.focus()}
                disabled={disabled}
              />
            ))}
          </ul>
          {hasHiddenRecoveries ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {showAllRecoveries
                  ? `복구본 ${recoveries.length}개를 모두 표시합니다.`
                  : `최신 5개를 표시합니다. 나머지 ${recoveries.length - 5}개도 보존 기간과 최근 20개 기준 안에서 이 기기에 유지됩니다.`}
              </p>
              <button
                type="button"
                disabled={disabled}
                aria-expanded={showAllRecoveries}
                aria-controls={recoveryListId}
                onClick={() => setShowAllRecoveries((current) => !current)}
                className="font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {showAllRecoveries ? "최신 5개만 보기" : "모든 복구본 보기"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
