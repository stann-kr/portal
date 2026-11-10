"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <RouteErrorState
      title="포탈을 불러오지 못했습니다"
      description="잠시 후 다시 시도해 주세요. 작성 중이던 내용이 있다면 현재 창을 닫지 마세요."
      onRetry={reset}
    />
  );
}
