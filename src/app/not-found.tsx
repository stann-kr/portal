import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "페이지를 찾을 수 없음" };

/** 없는 주소. 캔버스 States 보드의 상태 면(옅은 선 r10·왼쪽 정렬)과 같은 모양으로 포털 복귀를 안내한다. */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-12">
      <section className="flex w-full max-w-md flex-col items-start justify-center gap-3 rounded-lg border border-muted px-6 py-10 md:px-8 md:py-12">
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 className="text-base font-semibold text-foreground">페이지를 찾을 수 없습니다</h1>
        <p className="max-w-[300px] text-body text-secondary-foreground">
          주소가 바뀌었거나 더 이상 제공되지 않는 페이지입니다.
        </p>
        <Button asChild className="mt-1">
          <Link href="/dashboard">포털로 돌아가기</Link>
        </Button>
      </section>
    </div>
  );
}
