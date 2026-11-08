"use client";

import { useEffect, useRef } from "react";
import { COLLAB_NOTICE_INSET_ATTRIBUTE } from "@/lib/collab/collab-events";
import type { CollabDocumentState } from "@/lib/collab/client/useCollabDocument";

const REBASE_MESSAGES: Record<NonNullable<CollabDocumentState["rebaseNotice"]>, string> = {
  applied: "연결이 끊긴 동안 이 기기에서 입력한 내용을 최신 문서에 다시 반영했습니다.",
  overlapped: "이 기기에서 입력한 내용이 다른 변경과 겹쳐 두 내용을 모두 문서에 남겼습니다. 확인해 정리해 주세요.",
  kept: "이 기기에서 입력한 내용을 문서에 반영하지 못해 이전 초안 보관함에 남겼습니다.",
  restored: "다른 기기에서 이전 버전으로 되돌렸습니다. 바뀐 내용 위에서 그대로 이어 쓸 수 있습니다.",
};

const ACTION_CLASS =
  "inline-flex min-h-8 items-center rounded-md px-2.5 text-ui text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type NoticeSource = Pick<
  CollabDocumentState,
  "rebaseNotice" | "dismissRebaseNotice" | "restoreChoice" | "keepRestoreInput" | "removeRestoreInput" | "undoRestoreChoice"
>;

/**
 * 다시 적용 결과와 "복원과 겹친 내 입력" 선택 안내. 문서 흐름 밖(화면 아래 떠 있는 줄)에 그려 편집기가 밀리거나 흔들리지 않고,
 * 고르지 않아도 편집은 그대로 이어진다(모달 아님). 제거는 [되돌리기]로 복구할 수 있다.
 */
export function CollabNotices({ collab }: { collab: NoticeSource }) {
  const { rebaseNotice, restoreChoice } = collab;
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = Boolean(rebaseNotice || restoreChoice);
  // 떠 있는 안내가 입력 줄을 가리지 않게, 보이는 동안 그 높이만큼 문서 아래 여백을 두고 편집기 자동 스크롤 여백으로 알린다
  // (위쪽 내용은 움직이지 않는다).
  useEffect(() => {
    const element = containerRef.current;
    if (!visible || !element) return;
    const body = document.body;
    const previous = body.style.paddingBottom;
    const apply = () => {
      const inset = Math.ceil(element.getBoundingClientRect().height) + 16;
      body.style.paddingBottom = `${inset}px`;
      body.dataset[COLLAB_NOTICE_INSET_ATTRIBUTE] = String(inset);
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      body.style.paddingBottom = previous;
      delete body.dataset[COLLAB_NOTICE_INSET_ATTRIBUTE];
    };
  }, [visible, restoreChoice, rebaseNotice]);
  if (!visible) return null;
  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[var(--z-overlay)] flex flex-col items-center gap-2 md:inset-x-auto md:left-1/2 md:w-[min(36rem,calc(100%-2rem))] md:-translate-x-1/2"
      data-collab-notices=""
    >
      {restoreChoice ? (
        <div
          className="pointer-events-auto flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-background px-3.5 py-2.5 text-ui shadow-floating"
          role="status"
          data-restore-choice={restoreChoice.state}
        >
          <span className="min-w-0 flex-1 text-muted-foreground">
            {restoreChoice.state === "offer" ? (
              <>
                <span className="md:hidden">이전 버전으로 되돌려졌고 내 입력은 남겨 두었습니다.</span>
                <span className="hidden md:inline">다른 기기에서 이전 버전으로 되돌렸습니다. 이 기기에서 그 사이 입력한 내용은 문서에 남겨 두었습니다.</span>
              </>
            ) : restoreChoice.partial
                ? "내 입력을 제거했습니다. 그 뒤에 고친 부분은 남겨 두었습니다."
                : "내 입력을 제거해 되돌린 버전 그대로입니다."}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {restoreChoice.state === "offer" ? (
              <>
                <button type="button" className={ACTION_CLASS} onClick={collab.keepRestoreInput}>
                  내 입력 유지
                </button>
                <button type="button" className={ACTION_CLASS} onClick={collab.removeRestoreInput}>
                  내 입력 제거
                </button>
              </>
            ) : (
              <>
                <button type="button" className={ACTION_CLASS} onClick={collab.undoRestoreChoice}>
                  되돌리기
                </button>
                <button type="button" className={ACTION_CLASS} onClick={collab.keepRestoreInput}>
                  닫기
                </button>
              </>
            )}
          </span>
        </div>
      ) : null}
      {rebaseNotice ? (
        <div
          className="pointer-events-auto flex w-full flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-2.5 text-ui shadow-floating"
          role="status"
        >
          <span className="min-w-0 flex-1 text-muted-foreground">{REBASE_MESSAGES[rebaseNotice]}</span>
          <button type="button" onClick={collab.dismissRebaseNotice} className={ACTION_CLASS}>
            닫기
          </button>
        </div>
      ) : null}
    </div>
  );
}
