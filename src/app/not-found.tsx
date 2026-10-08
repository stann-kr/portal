import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-6">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <p className="font-mono text-sm font-semibold text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">페이지를 찾을 수 없습니다</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          주소가 바뀌었거나 더 이상 제공되지 않는 페이지입니다.
        </p>
        <Button asChild className="mt-7">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            포털로 돌아가기
          </Link>
        </Button>
      </section>
    </div>
  );
}
