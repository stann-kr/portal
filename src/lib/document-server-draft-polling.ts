export const DOCUMENT_SERVER_DRAFT_POLL_MIN_MS = 15_000;
export const DOCUMENT_SERVER_DRAFT_POLL_MAX_MS = 120_000;

export type DocumentServerDraftPollState = {
  visible: boolean;
  online: boolean;
  unchangedPolls: number;
};

/**
 * active editor만 poll하고, 원격본이 연속으로 같으면 2회마다 간격을 두 배로 늘린다.
 * focus·online·local queue 변화 시 caller가 unchangedPolls를 0으로 재설정한다.
 */
export function getDocumentServerDraftPollDelay(
  state: DocumentServerDraftPollState,
): number | null {
  if (!state.visible || !state.online) return null;
  const unchangedPolls = Number.isSafeInteger(state.unchangedPolls)
    ? Math.max(0, state.unchangedPolls)
    : 0;
  const exponent = Math.min(3, Math.floor(unchangedPolls / 2));
  return Math.min(
    DOCUMENT_SERVER_DRAFT_POLL_MIN_MS * 2 ** exponent,
    DOCUMENT_SERVER_DRAFT_POLL_MAX_MS,
  );
}
