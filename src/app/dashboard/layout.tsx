/**
 * @file src/app/dashboard/layout.tsx
 * @description 대시보드 공통 레이아웃.
 * - admin: 56px 아이콘 레일 (AdminSideRail) + 풀-너비 main (p-0)
 * - student: 56px 아이콘 레일 (StudentSideRail) + 풀-너비 main (p-0)
 */
import { getActiveAuthSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { StudentSideRail } from "@/components/student-portal/StudentSideRail";
import { AdminSideRail } from "@/components/admin-portal/AdminSideRail";
import { LocalDraftAccountBoundary } from "@/components/auth/LocalDraftAccountBoundary";
import { isAccountDeletionEnabled } from "@/lib/account-privacy-rollout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getActiveAuthSession();

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role ?? "student";
  const ownerId = session.user.id;
  if (!ownerId) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      <LocalDraftAccountBoundary ownerId={ownerId} role={role} />
      {role === "admin" ? (
        <AdminSideRail ownerId={ownerId} />
      ) : (
        <StudentSideRail
          ownerId={ownerId}
          accountDeletionEnabled={isAccountDeletionEnabled()}
        />
      )}
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
