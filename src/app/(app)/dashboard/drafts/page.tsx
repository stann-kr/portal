import { redirect } from "next/navigation";
import { LegacyDraftArchive } from "@/components/drafts/LegacyDraftArchive";
import { RecordPageFrame } from "@/components/notes/DocumentRecordFrame";
import { listLegacyServerDrafts } from "@/lib/actions/legacyDrafts";
import { getActiveAuthSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "이전 초안 보관함" };

/** 실시간 공동 편집 전의 기기·계정 초안을 읽기 전용으로 보고 복사·삭제하는 화면. */
export default async function LegacyDraftsPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const serverDrafts = await listLegacyServerDrafts();

  return (
    <RecordPageFrame
      width="trash"
      back={{
        href: session.user.role === "admin" ? "/dashboard/admin" : "/dashboard/student",
        label: "홈으로 돌아가기",
      }}
      title="이전 초안 보관함"
    >
      <LegacyDraftArchive actorId={session.user.id} serverDrafts={serverDrafts} />
    </RecordPageFrame>
  );
}
