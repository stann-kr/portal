/**
 * @file src/app/dashboard/page.tsx
 * @description 로그인 후 역할(role) 기반 대시보드 자동 리다이렉트.
 * /dashboard 직접 접근 또는 로그인 성공 후 기본 랜딩 포인트로 사용.
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "admin") {
    redirect("/dashboard/admin");
  }

  redirect("/dashboard/student");
}
