import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { LocalDraftAccountBoundary } from "@/components/auth/LocalDraftAccountBoundary";
import { createDb, createDbContext } from "@/db/client";
import { isAccountDeletionEnabled } from "@/lib/account-privacy-rollout";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { resolveGuideViewerAccess } from "@/lib/guide-access";
import { queryAdminWorkCount } from "@/lib/student-roster";
import { AppShellSkeleton } from "./AppShellSkeleton";
import { AppSidebar } from "./AppSidebar";

/**
 * 로그인한 화면의 공통 골격: 왼쪽 사이드바(좁은 화면은 위쪽 막대와 메뉴 서랍)와 그 옆의 화면 영역.
 * 화면 영역이 자체 스크롤을 가져 사이드바는 고정된 채로 남는다.
 *
 * 계정 확인(DB profile 대조)과 업무 건수를 기다리는 동안 첫 진입·새로고침 화면이 비지 않도록
 * 그 기다림을 Suspense 안에 두고, 사이드바 자리와 주소에 맞는 본문 스켈레톤을 먼저 보낸다.
 * fallback은 children을 그리지 않는다. children은 AppSidebar 안 한 자리에만 있어 경계가 풀릴 때
 * 화면이 다른 위치로 옮겨 다시 mount되는 일이 없다. 화면 이동(같은 layout 유지)과 router.refresh는
 * 이미 보인 경계를 fallback으로 되돌리지 않으므로 이 스켈레톤은 첫 진입에만 보인다.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      <Suspense fallback={<AppShellSkeleton />}>
        <AuthenticatedShell>{children}</AuthenticatedShell>
      </Suspense>
    </div>
  );
}

async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const session = await getActiveAuthSession();
  const ownerId = session?.user?.id;
  // proxy가 JWT 없는 요청을 먼저 로그인으로 보낸다. 여기는 지워졌거나 비활성인 profile의 마지막 방어선이다.
  if (!session?.user || !ownerId) redirect("/login");

  const role = session.user.role === "admin" ? "admin" : "student";
  const displayName = session.user.name || (role === "admin" ? "Stann" : "학생");
  // 업무함 숫자는 Stann에게만 서버에서 센다. 세지 못해도 화면은 그대로 열고 숫자만 숨긴다.
  const workCount = role === "admin" ? await queryAdminWorkCount(createDb()).catch(() => null) : null;
  // 가이드가 열리지 않은 학생은 메뉴에서 가이드를 뺀다. 확인하지 못하면 숨긴다(열람 자체는 가이드 화면이 다시 판정한다).
  const guideHidden = role === "student"
    ? await resolveGuideViewerAccess(createDbContext(), { id: ownerId, isAdmin: false }).then((access) => access.kind === "closed", () => true)
    : false;

  return (
    <>
      <LocalDraftAccountBoundary ownerId={ownerId} role={role} />
      <AppSidebar
        role={role}
        displayName={displayName}
        ownerId={ownerId}
        canDeleteAccount={role === "student" && isAccountDeletionEnabled()}
        workCount={workCount}
        guideHidden={guideHidden}
      >
        {children}
      </AppSidebar>
    </>
  );
}
