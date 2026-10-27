import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedQnaThreads } from "@/lib/actions/qna";
import { QnaThreadLifecycleActions } from "@/components/qna/QnaThreadLifecycleActions";
import {
  RecordEmpty,
  RecordList,
  RecordPageFrame,
  TrashRecordItem,
} from "@/components/notes/DocumentRecordFrame";
import { formatTrashDeadline, formatTrashTime } from "@/components/notes/note-display";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";
import { safeReturnPath } from "@/lib/safe-return-path";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "Q&A 휴지통" };

/** Q&A 휴지통. 노트 휴지통(NotesTrash 보드)과 같은 틀이다. */
export default async function QnaTrashPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const threads = await getTrashedQnaThreads();
  const isAdmin = session.user.role === "admin";
  const returnTo = safeReturnPath((await searchParams).returnTo, "/dashboard/qna");
  const trashHref = `/dashboard/qna/trash?returnTo=${encodeURIComponent(returnTo)}`;
  const now = getRequestNow();

  return (
    <RecordPageFrame
      width="trash"
      back={{ href: returnTo, label: "Q&A 목록으로 돌아가기" }}
      title="Q&A 휴지통"
      description="삭제한 스레드와 답변은 30일 동안 보존되며, 만료 뒤에는 관리자만 영구 삭제할 수 있습니다."
    >
      {threads.length === 0 ? (
        <RecordEmpty icon={Trash2}>휴지통이 비어 있습니다.</RecordEmpty>
      ) : (
        <RecordList label="휴지통의 Q&A">
          {threads.map((thread) => {
            const expired = Boolean(
              thread.purgeEligibleAt && thread.purgeEligibleAt.getTime() <= now,
            );
            return (
              <TrashRecordItem
                key={thread.id}
                title={thread.title}
                href={`/dashboard/qna/${thread.id}?returnTo=${encodeURIComponent(trashHref)}`}
                meta={`${isAdmin ? `${thread.studentName ?? "학생"} · ` : ""}${QNA_STATUS_LABELS[thread.status]} · 삭제 ${formatTrashTime(thread.deletedAt, now)}`}
                expired={expired}
                state={expired
                  ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                  : `복원 가능: ${formatTrashDeadline(thread.purgeEligibleAt, now)}까지`}
                actions={
                  <QnaThreadLifecycleActions
                    threadId={thread.id}
                    version={thread.version}
                    deletedAt={thread.deletedAt!.toISOString()}
                    canRestore={!expired}
                    canPurge={isAdmin && expired}
                    returnTo={trashHref}
                  />
                }
              />
            );
          })}
        </RecordList>
      )}
    </RecordPageFrame>
  );
}
