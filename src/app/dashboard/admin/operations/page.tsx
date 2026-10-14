import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { MediaCleanupControl } from "@/components/admin-portal/MediaCleanupControl";
import { AccountErasureCleanupControl } from "@/components/admin-portal/AccountErasureCleanupControl";

export const metadata = { title: "관리자 운영 도구" };

export default function AdminOperationsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link href="/dashboard/admin?section=work" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />업무함으로 돌아가기
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ShieldAlert className="size-6 text-warning" aria-hidden="true" />운영 도구</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">일상 업무와 분리된 유지보수 작업입니다. 각 작업의 범위를 확인하고 한 번 더 확인한 뒤 실행하세요.</p>
        </div>
      </header>
      <div className="space-y-3">
        <MediaCleanupControl />
        <AccountErasureCleanupControl />
      </div>
    </div>
  );
}
