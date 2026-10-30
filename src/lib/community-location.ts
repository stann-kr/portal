export const COMMUNITY_BOARD_TYPES = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"] as const;

export type CommunityBoardType = (typeof COMMUNITY_BOARD_TYPES)[number];

/** `/community?boardType=` 값을 서버와 client가 같은 규칙으로 해석한다. */
export function resolveCommunityBoardType(value: unknown): CommunityBoardType {
  return COMMUNITY_BOARD_TYPES.find((type) => type === value) ?? "GENERAL";
}

export const COMMUNITY_BOARD_LABELS: Record<CommunityBoardType, string> = {
  ANNOUNCEMENT: "공지",
  GENERAL: "자유",
  FEEDBACK: "믹스셋",
};

/** 이력 등에서 보이는 게시판 위치. 내부 값 대신 게시판 이름을 쓰고, 채널은 자유 게시판에서만 붙인다. */
export function describeCommunityBoardLocation(boardType: string, category: string | null | undefined): string {
  const type = COMMUNITY_BOARD_TYPES.find((value) => value === boardType);
  const label = type ? COMMUNITY_BOARD_LABELS[type] : "게시판";
  return type === "GENERAL" && category ? `${label} · # ${category}` : label;
}
