"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

export default function CommunityError({ reset }: { reset: () => void }) {
  return (
    <RouteErrorState
      title="커뮤니티를 불러오지 못했습니다"
      description="작성 중이던 내용은 현재 창에 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요."
      onRetry={reset}
    />
  );
}
