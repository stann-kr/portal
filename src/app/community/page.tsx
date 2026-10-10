/**
 * @file src/app/community/page.tsx
 * @description 커뮤니티 메인 페이지 — RSC 래퍼.
 *
 * "use client" 페이지에서 "use server" 액션을 직접 임포트하면
 * Next.js 15 정적 생성 시 RSC 페이로드 chunk 참조가 undefined로 평가되어
 * `TypeError: Cannot read properties of undefined (reading 'env')` 발생.
 *
 * 해결: page.tsx를 RSC로 유지하고, 모든 클라이언트 로직을 CommunityClient로 분리.
 * RSC 레이어에서 서버 액션을 직접 임포트하지 않으므로 정적 생성 문제 없음.
 */
export const dynamic = "force-dynamic";

import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import CommunityClient from "./CommunityClient";

export const metadata = { title: "커뮤니티" };

export default async function CommunityPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = session?.user?.role === "admin";
  return <CommunityClient isAdmin={isAdmin} />;
}
