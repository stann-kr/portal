"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { AlertCircle, FileClock, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  discardAllLocalDocumentDrafts,
  discardLocalDocumentDraft,
  readLocalDocumentDrafts,
} from "@/lib/local-draft-continuity-client";
import type { DocumentDraftKind } from "@/lib/form-draft";
import type { LocalDocumentDraftSummary } from "@/lib/local-document-drafts";
import { formatKst } from "@/lib/kst-format";

const DRAFT_KIND_LABELS: Readonly<Record<DocumentDraftKind, string>> = {
  note: "개인 노트",
  "community-post": "커뮤니티 글",
  "community-comment": "커뮤니티 댓글",
  "assignment-feedback": "과제 피드백",
  "qna-thread": "1:1 질문",
  "qna-reply": "1:1 답변",
};

function createDraftContextLabel(draft: LocalDocumentDraftSummary): string {
  if (draft.contextId === "new" || draft.contextId.startsWith("new:")) {
    return "새 문서";
  }
  const compactId = Array.from(draft.contextId).slice(0, 8).join("");
  return `문서 ${compactId}${compactId === draft.contextId ? "" : "…"}`;
}

function formatSavedAt(savedAt: Date | null): string {
  return formatKst(savedAt, { dateStyle: "medium", timeStyle: "short" }, "저장 시각을 알 수 없음");
}

/** 계정 메뉴가 메뉴 항목을 고른 뒤 대화상자를 여는 연결점. */
export type AccountDialogHandle = { open: () => void };

export function LocalDraftManager({
  ownerId,
  controlRef,
  hideTrigger = false,
}: {
  ownerId: string;
  controlRef?: Ref<AccountDialogHandle>;
  hideTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<LocalDocumentDraftSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmSourceKey, setConfirmSourceKey] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  // 삭제 직후 다음 초안 버튼(null이면 빈 상태)으로 focus를 옮길 대상. 목록이 다시 그려진 뒤 한 번만 쓴다.
  const focusAfterDiscardRef = useRef<string | null | undefined>(undefined);
  const discardButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyStateRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const result = readLocalDocumentDrafts(ownerId);
    setDrafts(result.drafts);
    setError(
      result.storageUnavailable || result.enumerationFailed
        ? "브라우저 저장소에 접근할 수 없어 초안 목록을 불러오지 못했습니다."
        : result.failedKeys.length > 0
          ? "일부 초안을 읽지 못했습니다. 저장소 권한을 확인해 주세요."
          : null,
    );
  }, [ownerId]);

  // 처음 목록은 대화상자를 여는 이벤트에서 읽고, 열려 있는 동안 다른 탭의 저장소 변경만 구독한다.
  useEffect(() => {
    if (!open) return;
    const handleStorage = () => refresh();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [open, refresh]);

  useEffect(() => {
    const focusTarget = focusAfterDiscardRef.current;
    if (focusTarget === undefined) return;
    focusAfterDiscardRef.current = undefined;
    const target = focusTarget
      ? discardButtonRefs.current.get(focusTarget)
      : emptyStateRef.current;
    target?.focus();
  }, [drafts]);

  const artifactCount = useMemo(
    () => drafts.reduce((total, draft) => total + draft.artifactCount, 0),
    [drafts],
  );

  const discardSource = (sourceKey: string) => {
    if (confirmSourceKey !== sourceKey) {
      setConfirmSourceKey(sourceKey);
      setConfirmAll(false);
      return;
    }
    const discardedIndex = drafts.findIndex(
      (draft) => draft.sourceKey === sourceKey,
    );
    const nextFocusSourceKey =
      drafts[discardedIndex + 1]?.sourceKey ??
      drafts[discardedIndex - 1]?.sourceKey ??
      null;
    const result = discardLocalDocumentDraft(ownerId, sourceKey);
    if (
      result.storageUnavailable ||
      result.enumerationFailed ||
      result.failedKeys.length > 0
    ) {
      setError("선택한 초안을 완전히 삭제하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    setConfirmSourceKey(null);
    focusAfterDiscardRef.current = nextFocusSourceKey;
    refresh();
  };

  const discardAll = () => {
    if (!confirmAll) {
      setConfirmAll(true);
      setConfirmSourceKey(null);
      return;
    }
    const result = discardAllLocalDocumentDrafts(ownerId);
    if (
      result.storageUnavailable ||
      result.enumerationFailed ||
      result.failedKeys.length > 0
    ) {
      setError("이 계정의 초안을 완전히 삭제하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    setConfirmAll(false);
    focusAfterDiscardRef.current = null;
    refresh();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      refresh();
    } else {
      setConfirmSourceKey(null);
      setConfirmAll(false);
      focusAfterDiscardRef.current = undefined;
      setError(null);
    }
  };
  useImperativeHandle(controlRef, () => ({ open: () => handleOpenChange(true) }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : <DialogTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="이 기기의 초안 관리"
          title="이 기기의 초안"
        >
          <FileClock className="size-4" aria-hidden="true" />
        </button>
      </DialogTrigger>}
      <DialogContent className="max-h-[min(80dvh,42rem)] max-w-lg overflow-hidden p-0">
        <DialogHeader className="mb-0 border-b border-border px-6 pb-4 pt-6 pr-12">
          <DialogTitle>이 기기의 초안</DialogTitle>
          <DialogDescription>
            이 계정이 아직 게시하거나 저장하지 않은 로컬 문서입니다. 로그아웃하면 모두 삭제됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-4">
          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {drafts.length > 0
              ? `이 기기에 로컬 초안 ${drafts.length}개가 있습니다.`
              : "이 기기에 남아 있는 로컬 초안이 없습니다."}
          </p>
          {error ? (
            <div
              role="alert"
              className="mb-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {drafts.length === 0 ? (
            <div
              ref={emptyStateRef}
              tabIndex={-1}
              className="py-10 text-center focus:outline-none"
            >
              <p className="text-sm font-medium text-foreground">남아 있는 초안이 없습니다.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                작성 중인 문서는 입력이 멈춘 뒤 자동으로 여기에 나타납니다.
              </p>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="로컬 초안 목록">
              {drafts.map((draft) => {
                const confirming = confirmSourceKey === draft.sourceKey;
                return (
                  <li
                    key={draft.sourceKey}
                    className="rounded-lg border border-border bg-muted/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          {DRAFT_KIND_LABELS[draft.kind]} · {createDraftContextLabel(draft)}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-foreground">
                          {draft.preview.title ?? draft.preview.body ?? "내용 미리보기를 만들 수 없는 초안"}
                        </p>
                        {draft.preview.title && draft.preview.body ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {draft.preview.body}
                          </p>
                        ) : null}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {formatSavedAt(draft.savedAt)} · 관련 기록 {draft.artifactCount}개
                        </p>
                        {draft.hasIncompatibleArtifact ? (
                          <p className="mt-1 text-[11px] font-medium text-warning">
                            일부 기록은 현재 앱에서 열 수 없지만 삭제할 수 있습니다.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {confirming ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmSourceKey(null)}
                          >
                            취소
                          </Button>
                        ) : null}
                        <Button
                          ref={(node) => {
                            if (node) discardButtonRefs.current.set(draft.sourceKey, node);
                            else discardButtonRefs.current.delete(draft.sourceKey);
                          }}
                          type="button"
                          variant={confirming ? "default" : "ghost"}
                          size={confirming ? "sm" : "icon"}
                          className={confirming ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "text-destructive"}
                          onClick={() => discardSource(draft.sourceKey)}
                          aria-label={confirming ? undefined : `${DRAFT_KIND_LABELS[draft.kind]} 초안 삭제`}
                        >
                          {confirming ? "삭제 확인" : <Trash2 className="size-4" aria-hidden="true" />}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {drafts.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
            <p className="text-xs text-muted-foreground">
              {drafts.length}개 문서 · 관련 기록 {artifactCount}개
            </p>
            <div className="flex items-center gap-2">
              {confirmAll ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmAll(false)}
                >
                  취소
                </Button>
              ) : null}
              <Button
                type="button"
                variant={confirmAll ? "default" : "outline"}
                size="sm"
                className={confirmAll ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "text-destructive"}
                onClick={discardAll}
              >
                {confirmAll ? "모두 삭제 확인" : "모두 삭제"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
