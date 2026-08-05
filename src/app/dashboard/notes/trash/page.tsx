import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { getTrashedPrivateNotes } from "@/lib/actions/privateNotes";
import { safeReturnPath } from "@/lib/safe-return-path";
import { NoteTrashActions } from "@/components/notes/NoteTrashActions";

export const metadata = { title: "노트 휴지통" };

export default async function NoteTrashPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; returnTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const studentId =
    session.user.role === "admin" ? query.studentId : session.user.id;
  const fallback =
    session.user.role === "admin"
      ? "/dashboard/admin?section=students"
      : "/dashboard/student?section=workspace&view=all";
  const returnTo = safeReturnPath(query.returnTo, fallback);

  if (!studentId) {
    return (
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          이전 작업으로 돌아가기
        </Link>
        <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
          관리자 휴지통은 학생 노트 화면에서 학생을 선택한 뒤 열어 주세요.
        </p>
      </main>
    );
  }

  const notes = await getTrashedPrivateNotes(studentId);
  const now = Date.now();

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          이전 작업으로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">노트 휴지통</h1>
            <p className="text-sm text-muted-foreground">
              삭제한 노트는 30일 동안 보존되며, 만료 뒤에는 관리자만 영구 삭제할 수 있습니다.
            </p>
          </div>
        </div>
      </header>

      {notes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          휴지통이 비어 있습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const expired = Boolean(
              note.purgeEligibleAt && note.purgeEligibleAt.getTime() <= now,
            );
            const noteReturnTo = `/dashboard/notes/trash?studentId=${encodeURIComponent(studentId)}&returnTo=${encodeURIComponent(returnTo)}`;
            return (
              <li
                key={note.id}
                className="space-y-3 rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/dashboard/notes/${note.id}?returnTo=${encodeURIComponent(noteReturnTo)}`}
                      className="font-medium hover:underline"
                    >
                      {note.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {note.authorName ?? "작성자 미상"} · 삭제 {note.deletedAt?.toLocaleString("ko-KR")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {expired
                        ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                        : `복원 가능: ${note.purgeEligibleAt?.toLocaleString("ko-KR")}까지`}
                    </p>
                  </div>
                  <NoteTrashActions
                    noteId={note.id}
                    version={note.version}
                    canRestore={!expired && (session.user.role === "admin" || session.user.id === note.authorId)}
                    canPurge={session.user.role === "admin" && expired}
                    returnTo={noteReturnTo}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
