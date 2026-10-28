/**
 * @file src/app/community/layout.tsx
 * @description 커뮤니티도 대시보드와 같은 사이드바 안에서 연다.
 */
import { AppShell } from "@/components/app-shell/AppShell";

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
