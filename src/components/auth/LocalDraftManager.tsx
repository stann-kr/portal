"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AlertCircle, FileText } from "lucide-react";
import {
  Dialog,
  DialogClose,
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
import { formatKst, formatKstShortDate } from "@/lib/kst-format";

// 화면 메뉴 이름(노트·커뮤니티·과제·Q&A)과 같은 말로 초안 종류를 보인다(캔버스 "Q&A 질문", "새 노트").
const DRAFT_KIND_LABELS: Readonly<Record<DocumentDraftKind, string>> = {
  note: "노트",
  "community-post": "커뮤니티 글",
  "community-comment": "커뮤니티 댓글",
  "assignment-feedback": "과제 피드백",
  "qna-thread": "Q&A 질문",
  "qna-reply": "Q&A 답변",
  "guide-page": "가이드 페이지",
};

function createDraftContextLabel(draft: LocalDocumentDraftSummary): string {
  if (draft.contextId === "new" || draft.contextId.startsWith("new:")) {
    return "새 문서";
  }
  const compactId = Array.from(draft.contextId).slice(0, 8).join("");
  return `문서 ${compactId}${compactId === draft.contextId ? "" : "…"}`;
}

/** 캔버스 메타 형식 "10월 26일 13:02"(올해가 아니면 연도를 붙인다). */
function formatSavedAt(savedAt: Date | null): string {
  const date = formatKstShortDate(savedAt);
  if (!date) return "저장 시각을 알 수 없음";
  return `${date} ${formatKst(savedAt, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

// 행 버튼은 넓은 화면 28px, 좁은 화면(아래 시트)은 44px 터치 대상. 하단 버튼은 32px/44px.
const ROW_BUTTON_CLASS = "h-11 rounded-touch px-3 text-ui md:h-7 md:rounded-md md:px-2.5 md:text-xs";
const FOOTER_BUTTON_CLASS = "h-11 rounded-touch text-body md:h-8 md:rounded-md md:text-ui";

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
  const emptyStateRef = useRef<HTMLParagraphElement>(null);

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
          className="flex size-11 items-center justify-center rounded-touch text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:size-8 md:rounded-md"
          aria-label="이 기기의 초안 관리"
          title="이 기기의 초안"
        >
          <FileText className="size-4" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </DialogTrigger>}
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>이 기기의 초안</DialogTitle>
          <DialogDescription>
            이 계정이 아직 게시하거나 저장하지 않은 로컬 문서입니다. 로그아웃하면 모두 삭제됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error ? (
            <div role="alert" className="flex gap-2 rounded-md bg-destructive-muted px-3 py-2.5 text-ui text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* 문서별·전체 삭제 뒤 목록이 비면 이 문장으로 초점을 옮긴다. */}
          <p
            ref={emptyStateRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-ui text-secondary-foreground focus:outline-none"
          >
            {drafts.length > 0 ? `이 기기에 로컬 초안 ${drafts.length}개가 있습니다.` : "이 기기에 남아 있는 로컬 초안이 없습니다."}
          </p>

          {drafts.length === 0 ? (
            <p className="border-t border-border pt-4 text-xs text-muted-foreground">
              작성 중인 문서는 입력이 멈춘 뒤 자동으로 여기에 나타납니다.
            </p>
          ) : (
            <ul className="flex flex-col border-t border-border" aria-label="로컬 초안 목록">
              {drafts.map((draft) => {
                const confirming = confirmSourceKey === draft.sourceKey;
                const kindLabel = DRAFT_KIND_LABELS[draft.kind];
                const title = draft.preview.title ?? draft.preview.body ?? "내용 미리보기를 만들 수 없는 초안";
                return (
                  <li
                    key={draft.sourceKey}
                    className="flex items-center justify-between gap-3 border-b border-muted py-2.5"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="truncate text-body text-foreground">{title}</p>
                      {draft.preview.title && draft.preview.body ? (
                        <p className="line-clamp-1 text-xs text-secondary-foreground">{draft.preview.body}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {kindLabel} · {createDraftContextLabel(draft)} · {formatSavedAt(draft.savedAt)}
                        {draft.artifactCount > 1 ? ` · 관련 기록 ${draft.artifactCount}개` : ""}
                      </p>
                      {draft.hasIncompatibleArtifact ? (
                        <p className="text-xs text-warning">
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
                          className={ROW_BUTTON_CLASS}
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
                        variant={confirming ? "destructive-solid" : "outline"}
                        size="sm"
                        className={ROW_BUTTON_CLASS}
                        onClick={() => discardSource(draft.sourceKey)}
                        aria-label={confirming ? undefined : `${kindLabel} 초안 삭제`}
                      >
                        {confirming ? "삭제 확인" : "삭제"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2">
            {drafts.length > 0 ? (
              <div className="flex items-center gap-1">
                {confirmAll ? (
                  <Button type="button" variant="ghost" className={FOOTER_BUTTON_CLASS} onClick={() => setConfirmAll(false)}>
                    취소
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={confirmAll ? "destructive-solid" : "destructive"}
                  className={FOOTER_BUTTON_CLASS}
                  onClick={discardAll}
                >
                  {confirmAll ? "모두 삭제 확인" : "모두 삭제"}
                </Button>
              </div>
            ) : <span />}
            <DialogClose asChild>
              <Button type="button" variant="outline" className={FOOTER_BUTTON_CLASS}>
                닫기
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
