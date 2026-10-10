/** 커뮤니티 목록 한 번에 읽는 게시물 수. */
export const COMMUNITY_PAGE_SIZE = 30;
/** 목록 미리보기(100자 안팎)에 필요한 만큼만 본문 앞부분을 읽는다. */
export const COMMUNITY_PREVIEW_SOURCE_CHARS = 4_096;

const MAX_CURSOR_LENGTH = 512;
const MAX_ID_LENGTH = 128;

/** 목록 정렬 키(고정 여부·작성 시각 초·ID)의 마지막 값. 다음 페이지는 이 값보다 뒤만 읽는다. */
export type CommunityPostCursor = {
  pinned: 0 | 1;
  createdAt: number;
  id: string;
};

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeCommunityPostCursor(cursor: CommunityPostCursor): string {
  return toBase64Url(JSON.stringify([cursor.pinned, cursor.createdAt, cursor.id]));
}

/** client가 돌려준 cursor를 엄격히 해석한다. 형식이 다르면 null. */
export function decodeCommunityPostCursor(value: unknown): CommunityPostCursor | null {
  if (typeof value !== "string" || !value || value.length > MAX_CURSOR_LENGTH || !/^[\w-]+$/u.test(value)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const [pinned, createdAt, id] = parsed as unknown[];
  if (
    (pinned !== 0 && pinned !== 1) ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    typeof id !== "string" ||
    !id ||
    id.length > MAX_ID_LENGTH
  ) {
    return null;
  }
  return { pinned, createdAt, id };
}
