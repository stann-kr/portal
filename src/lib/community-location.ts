export const COMMUNITY_BOARD_TYPES = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"] as const;

export type CommunityBoardType = (typeof COMMUNITY_BOARD_TYPES)[number];

/** `/community?boardType=` 값을 서버와 client가 같은 규칙으로 해석한다. */
export function resolveCommunityBoardType(value: unknown): CommunityBoardType {
  return COMMUNITY_BOARD_TYPES.find((type) => type === value) ?? "GENERAL";
}
