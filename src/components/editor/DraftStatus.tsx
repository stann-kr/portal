"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { ServerDraftStatus } from "@/components/editor/ServerDraftStatus";
import { buttonClassName } from "@/components/ui/button";
import type { FormDraftRecoverySummary, FormDraftStatus } from "@/lib/form-draft";
import type {
  DocumentServerDraftSyncResult,
  DocumentServerDraftSyncStatus,
} from "@/lib/hooks/useDocumentServerDraftSync";
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

const QUIET_VISIBLE_LOCAL_STATUSES: ReadonlySet<FormDraftStatus> = new Set(["error", "incompatible", "conflict"]);
const QUIET_VISIBLE_SERVER_STATUSES: ReadonlySet<DocumentServerDraftSyncStatus> = new Set([
  "remote-available",
  "conflict",
  "error",
  "offline",
]);

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
        <AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
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
        <AlertTriangle className="mt-px size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
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
        <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        다른 작성 흐름을 감지했습니다. 현재 입력은 별도 안전본으로 보관했습니다.
      </p>
    );
  }

  if (status === "saving") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.8} aria-hidden="true" />
        이 기기에 임시 저장 중…
      </p>
    );
  }

  if (status === "saved") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {restored ? (
          <RotateCcw className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Check className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        )}
        {restored ? "저장되지 않은 작성 내용을 복원했습니다" : "이 기기에 임시 저장됨"}
        {time ? <span className="font-mono">· {time}</span> : null}
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
    <li className="flex flex-col gap-2 rounded-md border border-warning-border bg-background p-2.5 text-xs">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <time
            dateTime={recoveryIsoTime}
            className="font-mono text-muted-foreground"
          >
            {recoveryTime} · 이 기기에 최대 30일 보관
          </time>
          {recovery.isCurrent ? (
            <span className="rounded-sm bg-warning-muted px-1.5 py-px text-[11px] font-medium text-warning">
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
          className="flex flex-col gap-2 rounded-md border border-destructive-border bg-destructive-muted p-2.5"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancelDiscard();
          }}
        >
          <p id={confirmationId} role="alert" className="text-ui text-destructive">
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
              className={buttonClassName({ variant: "outline", size: "sm" })}
            >
              취소
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={confirmDiscard}
              className={buttonClassName({ variant: "destructive", size: "sm" })}
              aria-describedby={confirmationId}
              aria-label={`${recoveryAccessibleName} 복구본 삭제 확인`}
            >
              삭제 확인
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {onRestoreRecovery ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRestoreRecovery(recovery.storageKey)}
              className={buttonClassName({ variant: "outline", size: "sm" })}
              aria-label={`${recoveryAccessibleName} 충돌 복구본 복원`}
            >
              <RotateCcw className="size-3" strokeWidth={1.8} aria-hidden="true" />
              복원
            </button>
          ) : null}
          {onDiscardRecovery ? (
            <button
              ref={discardTriggerRef}
              type="button"
              disabled={disabled}
              onClick={() => setIsConfirmingDiscard(true)}
              className={buttonClassName({ variant: "ghost", size: "sm", className: "hover:text-destructive" })}
              aria-label={`${recoveryAccessibleName} 충돌 복구본 삭제 확인 열기`}
            >
              <Trash2 className="size-3" strokeWidth={1.8} aria-hidden="true" />
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
  quiet = false,
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
  /**
   * 자동 저장 문서에서는 평소의 임시 저장 진행 문구를 숨기고, 복원·충돌·오류·다른 기기 작성본처럼
   * 사용자가 판단할 일이 있을 때만 보여 준다.
   */
  quiet?: boolean;
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
      className="flex flex-col gap-2"
    >
      {!quiet || restored || QUIET_VISIBLE_LOCAL_STATUSES.has(status) ? (
        <DraftStateLine
          status={status}
          canSubmit={canSubmit}
          savedAt={savedAt}
          restored={restored}
        />
      ) : null}
      {serverSync && (!quiet || QUIET_VISIBLE_SERVER_STATUSES.has(serverSync.status)) ? (
        <ServerDraftStatus sync={serverSync} disabled={disabled} />
      ) : null}
      {recoveries.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-muted p-3">
          <p
            role="status"
            aria-live="polite"
            className="text-xs font-medium text-foreground"
          >
            복구 가능한 작성본 {recoveries.length}개
          </p>
          <ul id={recoveryListId} className="flex flex-col gap-2">
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
            <div className="flex flex-col items-start gap-1 text-xs text-secondary-foreground">
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
                className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
