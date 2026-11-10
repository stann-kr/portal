/**
 * @file src/app/(app)/community/page.tsx
 * @description 커뮤니티 메인 페이지 — RSC 래퍼.
 * URL의 게시판·채널을 서버에서 확정하고 첫 목록을 함께 읽어, 첫 화면이 빈 상태를
 * 잠깐 보였다가 바뀌지 않게 한다. 이후 탭·채널 전환은 CommunityClient가 담당한다.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { getCategories } from "@/lib/actions/categories";
import { getCommunityPostPage, searchCommunityPosts } from "@/lib/actions/posts";
import { normalizeDocumentSearchQuery } from "@/lib/document-search";
import { resolveCommunitySearchScope } from "@/lib/community-search";
import { resolveCommunityBoardType } from "@/lib/community-location";
import { firstSearchValue } from "@/lib/portal-location";
import CommunityClient from "./CommunityClient";

export const metadata = { title: "커뮤니티" };

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ boardType?: string | string[]; category?: string | string[]; q?: string | string[]; scope?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = session.user.role === "admin";

  const params = await searchParams;
  const boardType = resolveCommunityBoardType(firstSearchValue(params.boardType));
  const categories = await getCategories();
  const requestedCategory = firstSearchValue(params.category);
  const category = categories.find((item) => item.slug === requestedCategory)?.slug
    ?? categories[0]?.slug
    ?? "";
  // 검색(?q=)은 Q&A 검색처럼 GET form으로 서버가 읽는다. 지금 게시판·채널 안, scope=all이면 전체에서 찾는다.
  const query = normalizeDocumentSearchQuery(params.q);
  const scope = resolveCommunitySearchScope(firstSearchValue(params.scope));
  const [page, search] = await Promise.all([
    getCommunityPostPage({ boardType, category }),
    query ? searchCommunityPosts({ boardType, category, query, scope }) : Promise.resolve(null),
  ]);

  return (
    <CommunityClient
      isAdmin={isAdmin}
      initial={{ boardType, category, categories, posts: page.posts, nextCursor: page.nextCursor }}
      search={search ? { query, scope, posts: search.posts } : null}
    />
  );
}
