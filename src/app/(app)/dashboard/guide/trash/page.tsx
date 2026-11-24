import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedGuidePages } from "@/lib/actions/guide";
import { GuideTrashActions } from "@/components/guide/GuideTrashActions";
import { RecordEmpty, RecordList, RecordPageFrame, TrashRecordItem } from "@/components/notes/DocumentRecordFrame";
import { formatTrashTime } from "@/components/notes/note-display";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "가이드 휴지통" };

/** 가이드 휴지통(관리자, 0039). 노트 휴지통과 같은 틀이며 가이드는 Stann 문서라 기한 없이 되살리거나 영구 삭제한다. */
export default async function GuideTrashPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/guide");
  const pages = await getTrashedGuidePages();
  const now = getRequestNow();
  return (
    <RecordPageFrame
      width="trash"
      back={{ href: "/dashboard/guide", label: "가이드로 돌아가기" }}
      title="가이드 휴지통"
      description="삭제한 가이드 페이지는 되살릴 때까지 학생에게 보이지 않습니다. 되살리면 질문 위치와 학생 열람 설정이 다시 이어집니다."
    >
      {pages.length === 0 ? (
        <RecordEmpty icon={Trash2}>휴지통이 비어 있습니다.</RecordEmpty>
      ) : (
        <RecordList label="휴지통의 가이드 페이지">
          {pages.map((page) => (
            <TrashRecordItem
              key={page.id}
              title={page.title}
              meta={`${page.deletedByName ?? "Stann"} · 삭제 ${formatTrashTime(page.deletedAt, now)}`}
              expired={false}
              state="되살리거나 영구 삭제할 수 있습니다."
              actions={<GuideTrashActions pageId={page.id} title={page.title} />}
            />
          ))}
        </RecordList>
      )}
    </RecordPageFrame>
  );
}
