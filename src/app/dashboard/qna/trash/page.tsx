import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedQnaThreads } from "@/lib/actions/qna";
import { QnaThreadLifecycleActions } from "@/components/qna/QnaThreadLifecycleActions";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";

export const metadata = { title: "Q&A 휴지통" };

export default async function QnaTrashPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const threads = await getTrashedQnaThreads();
  const isAdmin = session.user.role === "admin";
  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href="/dashboard/qna"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Q&amp;A 목록으로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Q&amp;A 휴지통</h1>
            <p className="text-sm text-muted-foreground">
              삭제한 스레드와 답변은 30일 동안 보존되며, 만료 뒤에는 관리자만 영구 삭제할 수 있습니다.
            </p>
          </div>
        </div>
      </header>

      {threads.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          휴지통이 비어 있습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => {
            const expired = Boolean(
              thread.purgeEligibleAt && thread.purgeEligibleAt.getTime() <= now,
            );
            return (
              <li key={thread.id} className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div>
                  <Link
                    href={`/dashboard/qna/${thread.id}?returnTo=${encodeURIComponent("/dashboard/qna/trash")}`}
                    className="font-medium hover:underline"
                  >
                    {thread.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isAdmin ? `${thread.studentName ?? "학생"} · ` : ""}
                    {QNA_STATUS_LABELS[thread.status]} · 삭제 {thread.deletedAt?.toLocaleString("ko-KR")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {expired
                      ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                      : `복원 가능: ${thread.purgeEligibleAt?.toLocaleString("ko-KR")}까지`}
                  </p>
                </div>
                <QnaThreadLifecycleActions
                  threadId={thread.id}
                  version={thread.version}
                  deletedAt={thread.deletedAt!.toISOString()}
                  canRestore={!expired}
                  canPurge={isAdmin && expired}
                  returnTo="/dashboard/qna/trash"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
