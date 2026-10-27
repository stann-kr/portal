/**
 * @file src/app/dashboard/layout.tsx
 * @description 대시보드 공통 레이아웃. 왼쪽 사이드바가 주요 메뉴와 계정 도구를 담는다.
 */
import { AppShell } from "@/components/app-shell/AppShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
