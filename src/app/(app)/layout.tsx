/**
 * @file src/app/(app)/layout.tsx
 * @description 로그인한 화면(대시보드·커뮤니티)의 공통 셸. 한 layout에 두어 대시보드↔커뮤니티를 오가도
 * 사이드바(넓은 화면)·위쪽 막대(좁은 화면)가 다시 그려지지 않고 본문만 불러오는 중으로 바뀐다.
 * 전에는 두 구역이 각자 AppShell을 가져 오갈 때마다 셸 전체 스켈레톤이 보였다(전체 페이지 로딩처럼 보임). 주소는 그대로다.
 */
import { AppShell } from "@/components/app-shell/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
