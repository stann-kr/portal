"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Copy,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { DocumentServerDraftSyncResult } from "@/lib/hooks/useDocumentServerDraftSync";
import type { FormDraftRecoveryPreview } from "@/lib/form-draft";
import { formatKst } from "@/lib/kst-format";
import { buttonClassName } from "@/components/ui/button";

const ICON = "size-3.5 shrink-0";
const LINK_BUTTON =
  "inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function formatServerDraftTime(value: number): string | null {
  return formatKst(value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) || null;
}

function DraftPreview({
  label,
  preview,
}: {
  label: string;
  preview: FormDraftRecoveryPreview | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-background p-2.5">
      <p className="text-xs font-medium text-foreground">{label}</p>
      {preview?.title ? (
        <p className="break-words text-xs text-foreground">
          <span className="font-medium">제목</span>
          <span aria-hidden="true"> · </span>
          {preview.title}
        </p>
      ) : null}
      {preview?.body ? (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-medium text-foreground">본문</span>
          <span aria-hidden="true"> · </span>
          {preview.body}
        </p>
      ) : null}
      {!preview?.title && !preview?.body ? (
        <p className="text-xs text-muted-foreground">내용 미리보기가 없습니다.</p>
      ) : null}
    </div>
  );
}

function ServerDraftStateLine({ sync }: { sync: DocumentServerDraftSyncResult }) {
  const savedTime = sync.remoteDraft
    ? formatServerDraftTime(sync.remoteDraft.updatedAt)
    : null;

  if (sync.status === "error") {
    return (
      <p role="alert" className="inline-flex items-start gap-1.5 text-xs text-destructive">
        <AlertTriangle className={`mt-px ${ICON}`} strokeWidth={1.8} aria-hidden="true" />
        <span>
          계정 초안을 동기화하지 못했습니다. 이 기기 초안과 재시도 요청은
          그대로 보존됩니다.
        </span>
      </p>
    );
  }
  if (sync.status === "offline") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CloudOff className={ICON} strokeWidth={1.8} aria-hidden="true" />
        오프라인 · 연결되면 계정 초안을 다시 저장합니다.
      </p>
    );
  }
  if (sync.status === "loading") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className={`${ICON} animate-spin motion-reduce:animate-none`} strokeWidth={1.8} aria-hidden="true" />
        계정 초안 확인 중…
      </p>
    );
  }
  if (sync.status === "queued" || sync.status === "syncing") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Cloud className={ICON} strokeWidth={1.8} aria-hidden="true" />
        {sync.status === "syncing" ? "계정에 임시 저장 중…" : "계정 저장 대기 중…"}
      </p>
    );
  }
  if (sync.status === "synced") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className={ICON} strokeWidth={1.8} aria-hidden="true" />
        계정에 임시 저장됨
        {savedTime ? <span className="font-mono">· {savedTime}</span> : null}
      </p>
    );
  }
  if (sync.status === "idle") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Cloud className={ICON} strokeWidth={1.8} aria-hidden="true" />
        입력하면 계정에도 최대 30일 임시 저장됩니다.
      </p>
    );
  }
  return null;
}

export function ServerDraftStatus({
  sync,
  disabled = false,
}: {
  sync: DocumentServerDraftSyncResult;
  disabled?: boolean;
}) {
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const confirmationId = useId();
  const recoveryDescriptionId = useId();
  const stableFocusRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const restoreDiscardFocusRef = useRef(false);
  const isChoosing = sync.status === "conflict" || sync.status === "remote-available" || Boolean(sync.queuedPreview);
  const actionsDisabled = disabled || sync.status === "loading" || sync.status === "syncing";

  useEffect(() => {
    if (isConfirmingDiscard) {
      cancelRef.current?.focus();
    } else if (restoreDiscardFocusRef.current) {
      restoreDiscardFocusRef.current = false;
      discardRef.current?.focus();
    }
  }, [isConfirmingDiscard]);

  // 다른 서버 초안이 오면 버리기 확인과 복사 결과를 그 렌더에서 바로 초기화한다.
  const remoteDraftVersion = sync.remoteDraft?.draftVersion;
  const remotePayloadHash = sync.remoteDraft?.payloadHash;
  const [shownRemoteDraft, setShownRemoteDraft] = useState({
    draftVersion: remoteDraftVersion,
    payloadHash: remotePayloadHash,
  });
  if (
    shownRemoteDraft.draftVersion !== remoteDraftVersion ||
    shownRemoteDraft.payloadHash !== remotePayloadHash
  ) {
    setShownRemoteDraft({ draftVersion: remoteDraftVersion, payloadHash: remotePayloadHash });
    setIsConfirmingDiscard(false);
    setCopyState("idle");
  }

  const copyRemote = async () => {
    if (!sync.remoteDraft) return;
    try {
      await navigator.clipboard.writeText(sync.remoteDraft.payloadJson);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const cancelDiscard = () => {
    restoreDiscardFocusRef.current = true;
    setIsConfirmingDiscard(false);
  };

  const confirmDiscard = () => {
    restoreDiscardFocusRef.current = false;
    stableFocusRef.current?.focus();
    setIsConfirmingDiscard(false);
    sync.discardRemoteDraft();
  };

  return (
    <div
      ref={stableFocusRef}
      role="group"
      aria-label="계정 초안 동기화 상태"
      tabIndex={-1}
      className="flex flex-col items-start gap-2"
    >
      <ServerDraftStateLine sync={sync} />

      {isChoosing ? (
        <div
          role="alert"
          className="flex w-full flex-col gap-2.5 rounded-lg border border-warning-border bg-warning-muted p-3"
        >
          <div className="flex flex-col gap-0.5 text-xs">
            <p className="text-ui font-semibold text-foreground">
              {sync.queuedPreview
                ? "이전에 보관한 작성본이 있습니다."
                : sync.status === "remote-available"
                ? "계정에 저장된 작성본이 있습니다."
                : "이 기기와 계정의 작성본이 다릅니다."}
            </p>
            <p className="text-secondary-foreground">
              자동으로 합치거나 덮어쓰지 않습니다. 사용할 작성본을 직접 선택해
              주세요.
              {sync.isDifferentDevice ? " 다른 기기에서 저장된 계정본입니다." : ""}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {sync.remoteDraft ? (
              <DraftPreview label="계정 작성본" preview={sync.remotePreview} />
            ) : (
              <DraftPreview label="계정 작성본 없음" preview={null} />
            )}
            {sync.localPreview ? (
              <DraftPreview label="이 기기 작성본" preview={sync.localPreview} />
            ) : null}
            {sync.queuedPreview ? (
              <DraftPreview label="보관된 작성본" preview={sync.queuedPreview} />
            ) : null}
          </div>

          {sync.queuedPreview ? (
            <p id={recoveryDescriptionId} className="text-xs text-secondary-foreground">
              복원하면 현재 입력란의 내용을 바꿉니다. 계정 작성본은 변경하지 않습니다.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {sync.queuedPreview ? (
              <button
                type="button"
                disabled={actionsDisabled}
                aria-describedby={recoveryDescriptionId}
                onClick={() => {
                  stableFocusRef.current?.focus();
                  sync.restoreQueuedDraft();
                }}
                className={buttonClassName({ variant: "outline", size: "sm" })}
              >
                <RotateCcw className="size-3" strokeWidth={1.8} aria-hidden="true" />
                보관된 작성본 복원
              </button>
            ) : null}
            {sync.remoteDraft ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => {
                  stableFocusRef.current?.focus();
                  sync.useRemoteDraft();
                }}
                className={buttonClassName({ variant: "outline", size: "sm" })}
              >
                <RotateCcw className="size-3" strokeWidth={1.8} aria-hidden="true" />
                계정 작성본 사용
              </button>
            ) : null}
            {sync.localPreview ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => {
                  stableFocusRef.current?.focus();
                  sync.keepLocalDraft();
                }}
                className={buttonClassName({ size: "sm" })}
              >
                내 초안으로 계속
              </button>
            ) : null}
            {sync.remoteDraft ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => void copyRemote()}
                className={buttonClassName({ variant: "ghost", size: "sm" })}
              >
                <Copy className="size-3" strokeWidth={1.8} aria-hidden="true" />
                계정 초안 원문 복사
              </button>
            ) : null}
          </div>
          {copyState !== "idle" ? (
            <p
              role={copyState === "error" ? "alert" : "status"}
              aria-live="polite"
              className={copyState === "error" ? "text-xs text-destructive" : "text-xs text-secondary-foreground"}
            >
              {copyState === "copied"
                ? "계정 초안 원문을 복사했습니다."
                : "원문을 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."}
            </p>
          ) : null}
        </div>
      ) : null}

      {sync.remoteDraft ? (
        isConfirmingDiscard ? (
          <div
            role="group"
            aria-labelledby={confirmationId}
            className="flex w-full flex-col gap-2 rounded-md border border-destructive-border bg-destructive-muted p-2.5 text-xs"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              cancelDiscard();
            }}
          >
            <p id={confirmationId} role="alert" className="text-ui text-destructive">
              계정에 저장된 초안만 삭제합니다. 이 기기 작성본은 남지만 삭제한
              계정본은 되돌릴 수 없습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={actionsDisabled}
                onClick={cancelDiscard}
                className={buttonClassName({ variant: "outline", size: "sm" })}
              >
                취소
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                aria-describedby={confirmationId}
                onClick={confirmDiscard}
                className={buttonClassName({ variant: "destructive", size: "sm" })}
              >
                계정 초안 삭제 확인
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={discardRef}
            type="button"
            disabled={actionsDisabled}
            onClick={() => setIsConfirmingDiscard(true)}
            className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-3" strokeWidth={1.8} aria-hidden="true" />
            계정 초안 삭제
          </button>
        )
      ) : null}

      {(sync.status === "error" || sync.status === "offline") ? (
        <button
          type="button"
          disabled={actionsDisabled || sync.status === "offline"}
          onClick={() => void sync.refresh()}
          className={`${LINK_BUTTON} text-xs`}
        >
          <RefreshCw className="size-3" strokeWidth={1.8} aria-hidden="true" />
          다시 확인
        </button>
      ) : null}
    </div>
  );
}
