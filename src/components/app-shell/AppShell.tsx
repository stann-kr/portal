import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { LocalDraftAccountBoundary } from "@/components/auth/LocalDraftAccountBoundary";
import { isAccountDeletionEnabled } from "@/lib/account-privacy-rollout";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { AppSidebar } from "./AppSidebar";

/**
 * 로그인한 화면의 공통 골격: 왼쪽 사이드바(좁은 화면은 위쪽 막대와 메뉴 서랍)와 그 옆의 화면 영역.
 * 화면 영역이 자체 스크롤을 가져 사이드바는 고정된 채로 남는다.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const session = await getActiveAuthSession();
  const ownerId = session?.user?.id;
  if (!session?.user || !ownerId) redirect("/login");

  const role = session.user.role === "admin" ? "admin" : "student";
  const displayName = session.user.name || (role === "admin" ? "관리자" : "학생");

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      <LocalDraftAccountBoundary ownerId={ownerId} role={role} />
      <Suspense
        fallback={
          <>
            <div className="hidden w-60 shrink-0 border-r border-border bg-sidebar md:block" />
            <div className="min-w-0 flex-1">{children}</div>
          </>
        }
      >
        <AppSidebar
          role={role}
          displayName={displayName}
          ownerId={ownerId}
          canDeleteAccount={role === "student" && isAccountDeletionEnabled()}
        >
          {children}
        </AppSidebar>
      </Suspense>
    </div>
  );
}
