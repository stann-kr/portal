import { SectionRouteSkeleton } from "@/components/ui/section-route-skeleton";

/**
 * 대시보드 안 다른 구역(가이드·관리자 등 자기 layout이 데이터를 기다리는 곳)으로 들어갈 때 먼저 보이는 스켈레톤.
 * 일반 모양 대신 주소에 맞는 모양을 골라, 하위 화면의 스켈레톤으로 바뀔 때 모양이 달라지지 않게 한다.
 */
export default function DashboardLoading() {
  return <SectionRouteSkeleton />;
}
