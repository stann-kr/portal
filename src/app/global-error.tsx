"use client";

import "./globals.css";
import { RouteErrorState } from "@/components/ui/route-error-state";

/** root layout 자체가 실패했을 때 layout을 대신하는 마지막 오류 화면. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ko">
      <body className="bg-background font-sans text-foreground antialiased">
        <main id="main-content">
          <RouteErrorState
            title="포탈을 열지 못했습니다"
            description="잠시 후 다시 시도해 주세요. 문제가 계속되면 Stann에게 알려 주세요."
            onRetry={reset}
          />
        </main>
      </body>
    </html>
  );
}
