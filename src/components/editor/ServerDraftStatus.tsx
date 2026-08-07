"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
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

function formatServerDraftTime(value: number): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function DraftPreview({
  label,
  preview,
}: {
  label: string;
  preview: FormDraftRecoveryPreview | null;
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-md border border-border/70 bg-background/75 p-2">
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
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          계정 초안을 동기화하지 못했습니다. 이 기기 초안과 재시도 요청은
          그대로 보존됩니다.
        </span>
      </p>
    );
  }
  if (sync.status === "offline") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-warning">
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
        오프라인 · 연결되면 계정 초안을 다시 저장합니다.
      </p>
    );
  }
  if (sync.status === "loading") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        계정 초안 확인 중…
      </p>
    );
  }
  if (sync.status === "queued" || sync.status === "syncing") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
        {sync.status === "syncing" ? "계정에 임시 저장 중…" : "계정 저장 대기 중…"}
      </p>
    );
  }
  if (sync.status === "synced") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        계정에 임시 저장됨
        {savedTime ? <span className="tabular-nums">· {savedTime}</span> : null}
      </p>
    );
  }
  if (sync.status === "idle") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
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
  const stableFocusRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const restoreDiscardFocusRef = useRef(false);
  const isChoosing = sync.status === "conflict" || sync.status === "remote-available";
  const actionsDisabled = disabled || sync.status === "loading" || sync.status === "syncing";

  useEffect(() => {
    if (isConfirmingDiscard) {
      cancelRef.current?.focus();
    } else if (restoreDiscardFocusRef.current) {
      restoreDiscardFocusRef.current = false;
      discardRef.current?.focus();
    }
  }, [isConfirmingDiscard]);

  useEffect(() => {
    setIsConfirmingDiscard(false);
    setCopyState("idle");
  }, [sync.remoteDraft?.draftVersion, sync.remoteDraft?.payloadHash]);

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
      className="space-y-2"
    >
      <ServerDraftStateLine sync={sync} />

      {isChoosing ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-warning/30 bg-warning-muted px-2.5 py-2"
        >
          <div className="space-y-0.5 text-xs">
            <p className="font-medium text-foreground">
              {sync.status === "remote-available"
                ? "계정에 저장된 작성본이 있습니다."
                : "이 기기와 계정의 작성본이 다릅니다."}
            </p>
            <p className="text-muted-foreground">
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
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            {sync.remoteDraft ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={sync.useRemoteDraft}
                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                계정 작성본 사용
              </button>
            ) : null}
            {sync.localPreview ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={sync.keepLocalDraft}
                className="font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                내 초안으로 계속
              </button>
            ) : null}
            {sync.remoteDraft ? (
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => void copyRemote()}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                계정 초안 원문 복사
              </button>
            ) : null}
          </div>
          {copyState !== "idle" ? (
            <p
              role={copyState === "error" ? "alert" : "status"}
              aria-live="polite"
              className={copyState === "error" ? "text-xs text-destructive" : "text-xs text-success"}
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
            className="space-y-2 rounded-md border border-destructive/25 bg-destructive/10 p-2 text-xs"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              cancelDiscard();
            }}
          >
            <p id={confirmationId} role="alert" className="text-destructive">
              계정에 저장된 초안만 삭제합니다. 이 기기 작성본은 남지만 삭제한
              계정본은 되돌릴 수 없습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={actionsDisabled}
                onClick={cancelDiscard}
                className="font-medium text-foreground hover:underline disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                aria-describedby={confirmationId}
                onClick={confirmDiscard}
                className="font-medium text-destructive hover:underline disabled:opacity-50"
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
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            계정 초안 삭제
          </button>
        )
      ) : null}

      {(sync.status === "error" || sync.status === "offline") ? (
        <button
          type="button"
          disabled={actionsDisabled || sync.status === "offline"}
          onClick={() => void sync.refresh()}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          다시 확인
        </button>
      ) : null}
    </div>
  );
}
