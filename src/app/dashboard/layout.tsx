/**
 * @file src/app/dashboard/layout.tsx
 * @description 대시보드 공통 레이아웃.
 * - admin: 56px 아이콘 레일 (AdminSideRail) + 풀-너비 main (p-0)
 * - student: 56px 아이콘 레일 (StudentSideRail) + 풀-너비 main (p-0)
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { StudentSideRail } from "@/components/student-portal/StudentSideRail";
import { AdminSideRail } from "@/components/admin-portal/AdminSideRail";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role ?? "student";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {role === "admin" ? <AdminSideRail /> : <StudentSideRail />}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
