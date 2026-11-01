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
};

/** 복원 준비로 편집이 잠시 멈췄음, 그리고 다시 적용 결과를 알린다. */
export function CollabNotices({
  frozen,
  rebaseNotice,
  onDismiss,
}: {
  frozen: boolean;
  rebaseNotice: CollabDocumentState["rebaseNotice"];
  onDismiss: () => void;
}) {
  if (!frozen && !rebaseNotice) return null;
  return (
    <div className="flex flex-col gap-2">
      {frozen ? (
        <p className="text-ui text-muted-foreground" role="status">
          다른 화면에서 이전 버전으로 되돌리는 중입니다. 지금까지의 내용을 저장한 뒤 곧 다시 편집할 수 있습니다.
        </p>
      ) : null}
      {rebaseNotice ? (
        <div className="flex flex-wrap items-center gap-3 text-ui text-muted-foreground" role="status">
          <span>{REBASE_MESSAGES[rebaseNotice]}</span>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-2 py-0.5 text-ui text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            닫기
          </button>
        </div>
      ) : null}
    </div>
  );
}
