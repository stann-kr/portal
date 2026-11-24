import { notFound, redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getGuidePageHistory } from "@/lib/actions/guide";
import { GuideRevisionRestoreButton } from "@/components/guide/GuideRevisionRestoreButton";
import { RichTextContent } from "@/components/editor/RichTextContent";
import {
  HistoryRecordItem,
  RECORD_ACTION_CELL,
  RECORD_FULL_ROW,
  RecordDetails,
  RecordEmpty,
  RecordList,
  RecordMeta,
  RecordPageFrame,
} from "@/components/notes/DocumentRecordFrame";
import { guidePagePath } from "@/lib/guide-content";
import { formatRecordTime } from "@/lib/kst-format";
import { getRequestNow } from "@/lib/request-time";
import { cn } from "@/lib/utils";
import { History } from "lucide-react";

export const metadata = { title: "가이드 변경 이력" };

const REASON_LABELS = { EDIT: "고치기 전 판", RESTORE: "되돌리기 전 판" } as const;

/** 가이드 페이지 이전 판(관리자, 0039). 노트 변경 이력과 같은 틀이며, 10분 안의 저장은 한 판으로 묶는다. */
export default async function GuidePageHistoryPage({ params }: { params: Promise<{ pageId: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { pageId } = await params;
  if (session.user.role !== "admin") redirect(guidePagePath(pageId));
  const history = await getGuidePageHistory(pageId);
  if (!history) notFound();
  const { page, revisions } = history;
  const now = getRequestNow();

  return (
    <RecordPageFrame
      width="history"
      back={{ href: guidePagePath(page.id), label: "페이지로 돌아가기" }}
      title="변경 이력"
      subtitle={<>{page.title} · 현재 <span className="font-mono">{page.version}</span>판</>}
      description="고치기 전 판을 10분에 한 번 남깁니다. 이전 판으로 되돌려도 지금 판은 이력에 남습니다."
    >
      {revisions.length === 0 ? (
        <RecordEmpty icon={History}>아직 남은 이전 판이 없습니다.</RecordEmpty>
      ) : (
        <RecordList ordered label="가이드 이전 판">
          {revisions.map((revision) => (
            <HistoryRecordItem
              key={revision.id}
              number={revision.pageVersion}
              changeLabel={REASON_LABELS[revision.reason]}
              meta={<RecordMeta time={formatRecordTime(revision.createdAt, now)} actor={revision.actorName ?? "Stann"} />}
              action={
                <span className={RECORD_ACTION_CELL}>
                  <GuideRevisionRestoreButton
                    pageId={page.id}
                    revisionId={revision.id}
                    baseVersion={page.version}
                    label={`${revision.pageVersion}판`}
                  />
                </span>
              }
            >
              <p className={cn(RECORD_FULL_ROW, "text-ui text-foreground")}>{revision.title}</p>
              <RecordDetails summary="이 판 본문 보기">
                <RichTextContent html={revision.contentHtml} className="text-body text-secondary-foreground" />
              </RecordDetails>
            </HistoryRecordItem>
          ))}
        </RecordList>
      )}
    </RecordPageFrame>
  );
}
