"use client";

import { RouteErrorState } from "@/components/ui/route-error-state";

/** 대시보드·커뮤니티 밖(로그인 등)의 렌더 오류를 한국어 재시도 화면으로 받는다. */
export default function RootError({ reset }: { reset: () => void }) {
  return (
    <RouteErrorState
      title="화면을 불러오지 못했습니다"
      description="잠시 후 다시 시도해 주세요. 문제가 계속되면 Stann에게 알려 주세요."
      onRetry={reset}
    />
  );
}
