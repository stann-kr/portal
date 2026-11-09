/**
 * @file src/lib/community-search.ts
 * @description 커뮤니티 게시물 검색(UsabilityBundle ⑬). Q&A 검색과 같은 규칙: 검색어는
 * normalizeDocumentSearchQuery로 다듬고, 띄어 쓴 낱말이 제목·본문(태그·속성 제외 평문)에 모두 있어야 한다.
 * 지금 게시판·채널 안에서 찾고(scope "current"), "전체에서 찾기"는 모든 게시판·채널(scope "all")에서 찾는다.
 */
import type { BoardType } from "@/db/schema";
import {
  getDocumentSearchWords,
  getSearchableDocumentText,
  normalizeDocumentSearchQuery,
} from "@/lib/document-search";

export type CommunitySearchScope = "current" | "all";

/** 검색 결과 최대 개수. 검색 결과는 이어 읽기 없이 한 번에 보인다. */
export const COMMUNITY_SEARCH_RESULT_LIMIT = 50;

export function resolveCommunitySearchScope(value: string | null | undefined): CommunitySearchScope {
  return value === "all" ? "all" : "current";
}

export function getCommunitySearchWords(query: string | string[] | undefined): string[] {
  return getDocumentSearchWords(normalizeDocumentSearchQuery(query));
}

/** 게시물 한 건이 검색어 낱말을 제목·본문에서 모두 갖는지. 낱말이 없으면 false(검색하지 않음). */
export function matchesCommunityPostSearch(
  post: { title: string; contentHtml: string },
  words: readonly string[],
): boolean {
  if (words.length === 0) return false;
  const title = post.title.normalize("NFKC").toLowerCase();
  const missing = words.filter((word) => !title.includes(word));
  if (missing.length === 0) return true;
  const body = getSearchableDocumentText(post.contentHtml).toLowerCase();
  return missing.every((word) => body.includes(word));
}

/**
 * 검색 범위의 게시판·채널 조건. 지금 범위는 목록과 같은 위치(자유 게시판은 채널까지),
 * 전체는 모든 게시판·채널이다. 지운(휴지통) 게시물 제외는 호출하는 쿼리가 목록과 같이 건다.
 */
export function communitySearchFilter(input: {
  scope: CommunitySearchScope;
  boardType: BoardType;
  category: string;
}): { boardType: BoardType | null; category: string | null } {
  if (input.scope === "all") return { boardType: null, category: null };
  return {
    boardType: input.boardType,
    category: input.boardType === "GENERAL" ? input.category : null,
  };
}

/** 검색 결과·빈 결과 문구. */
export function communitySearchSummary(query: string, count: number): string {
  return count === 0 ? `‘${query}’ 결과 없음` : `‘${query}’ 결과 ${count}개`;
}

/** 검색 위치를 담은 커뮤니티 주소. q가 비면 검색 없이 목록 주소다. */
export function communitySearchHref(input: {
  boardType: BoardType;
  category: string;
  query: string;
  scope?: CommunitySearchScope;
}): string {
  const params = new URLSearchParams({ boardType: input.boardType });
  if (input.category) params.set("category", input.category);
  if (input.query) params.set("q", input.query);
  if (input.query && input.scope === "all") params.set("scope", "all");
  return `/community?${params.toString()}`;
}
