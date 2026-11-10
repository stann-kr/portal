/**
 * @file src/app/(app)/dashboard/guide/layout.tsx
 * @description 가이드 공통 틀: 바깥 여백과 왼쪽 페이지 목차. 페이지를 옮겨도 이 layout은 다시 그리지 않아
 * 목차가 남고 본문만 불러오는 중으로 바뀐다. 목록 변경(새 페이지·삭제·순서·제목)은 action의 revalidatePath(layout)가 다시 읽힌다.
 */
import { redirect } from "next/navigation";
import { GuideShell } from "@/components/guide/GuideShell";
import { getGuidePages } from "@/lib/actions/guide";
import { getActiveAuthSession } from "@/lib/auth-guard";

export default async function GuideLayout({ children }: { children: React.ReactNode }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const pages = await getGuidePages();
  return (
    <GuideShell pages={pages.map(({ id, title }) => ({ id, title }))} canManage={session.user.role === "admin"}>
      {children}
    </GuideShell>
  );
}
