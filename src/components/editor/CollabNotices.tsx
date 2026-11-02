"use client";

import type { CollabDocumentState } from "@/lib/collab/client/useCollabDocument";

/**
 * 편집기가 아직 그려지지 않았을 때의 상태 줄. 최신 내용을 못 읽으면(복원 뒤 head 조회 실패) 자동 재시도 중임을 알리고
 * 바로 다시 시도할 수 있게 한다. 옛 내용으로 채우지 않는다.
 */
export function CollabLoadingState({
  label,
  deniedMessage,
  seedState,
  seedMessage,
  onRetry,
}: {
  label: string;
  deniedMessage: string | null;
  seedState: CollabDocumentState["seedState"];
  seedMessage: string | null;
  onRetry: () => void;
}) {
  if (deniedMessage) {
    return (
      <p className="py-6 text-ui text-muted-foreground" role="status">
        {deniedMessage}
      </p>
    );
  }
  if (seedState === "stopped") {
    return (
      <p className="py-6 text-ui text-muted-foreground" role="status">
        {seedMessage}
      </p>
    );
  }
  if (seedState === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-3 py-6 text-ui text-muted-foreground" role="status">
        <span>{seedMessage}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-2.5 py-1 text-ui text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          다시 시도
        </button>
      </div>
    );
  }
  return (
    <p className="py-6 text-ui text-muted-foreground" role="status">
      {label}
    </p>
  );
}

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
  if (!rebaseNotice && !restoreChoice) return null;
  return (
    <div
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
            {restoreChoice.state === "offer"
              ? "다른 기기에서 이전 버전으로 되돌렸습니다. 이 기기에서 그 사이 입력한 내용은 문서에 남겨 두었습니다."
              : restoreChoice.partial
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
