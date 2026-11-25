/**
 * 수강 종료한 학생의 보기 전용 상세(캔버스 UxReview1120Policies ⑩, 2026-11-20 사용자 결정).
 * '수강 종료한 학생' 목록의 이름에서 온다. 노트·과제·Q&A·디깅을 복원하지 않고 읽기만 하고, 고치기·추가·삭제는 없다.
 * 관리자이면서 대상이 수강 종료한 학생일 때만 그린다. 수강 중인 학생이면 원래 학생 상세로 보낸다.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { DiggingBoard } from "@/components/digging/DiggingBoard";
import { DiggingFeedbackList } from "@/components/digging/DiggingFeedbackPanel";
import { formatDugOn } from "@/lib/digging-day";
import { MixAnalysisRating } from "@/components/feedback/MixAnalysisReview";
import { mediaSourceLabel } from "@/components/player/media-source";
import { ReplyCard } from "@/components/qna/ReplyCard";
import { TabPendingMark } from "@/components/ui/tab-pending-mark";
import { getStudentById } from "@/lib/actions/students";
import {
  buildArchivedStudentHref,
  loadArchivedStudentRecords,
  resolveArchivedRecordTab,
  type ArchivedAssignmentRecord,
  type ArchivedDiggingRecord,
  type ArchivedRecordTab,
} from "@/lib/archived-student-records";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { formatKstDot } from "@/lib/kst-format";
import { formatAnalysisClock } from "@/lib/mix-analysis";
import { getRequestNow } from "@/lib/request-time";
import { formatTimestamp } from "@/lib/utils/format";
import { formatTimeRange } from "@/lib/time-range";
import { cn } from "@/lib/utils";
import { ArchivedRecordRow } from "./ArchivedRecordRow";
import { ArchivedStudentBanner } from "./ArchivedStudentBanner";

export const metadata = { title: "수강 종료한 학생" };

const TABS: { key: ArchivedRecordTab; label: string; empty: string }[] = [
  { key: "notes", label: "노트", empty: "노트가 없습니다." },
  { key: "assignments", label: "과제", empty: "제출한 과제가 없습니다." },
  { key: "qna", label: "Q&A", empty: "질문이 없습니다." },
  { key: "digging", label: "디깅", empty: "디깅 기록이 없습니다." },
];

const PLAYLIST_PROVIDER_LABEL = { beatport: "Beatport", soundcloud: "SoundCloud" } as const;

/** 디깅 탭(보기 전용): Stann의 디깅 피드백, 플레이리스트, 트랙 보드. */
function DiggingRecords({ record }: { record: ArchivedDiggingRecord }) {
  return (
    <div className="flex flex-col gap-8 pt-4">
      <DiggingFeedbackList feedbacks={record.feedbacks} />
      {record.playlists.length > 0 ? (
        <section aria-labelledby="archived-playlists-heading" className="flex flex-col gap-2">
          <h2 id="archived-playlists-heading" className="text-ui font-semibold text-secondary-foreground">플레이리스트</h2>
          <ul className="flex flex-col">
            {record.playlists.map((playlist) => (
              <li key={playlist.id} className="flex flex-col gap-0.5 border-b border-muted py-2.5">
                <a
                  href={playlist.url}
                  target="_blank"
                  rel="noreferrer"
                  className="self-start rounded-sm text-body font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {playlist.title || `${PLAYLIST_PROVIDER_LABEL[playlist.provider]} 플레이리스트`}
                  <span className="sr-only">(새 창에서 열기)</span>
                </a>
                <span className="font-mono text-xs text-muted-foreground">
                  <span className="sr-only">디깅한 날 </span>{formatDugOn(playlist.dugOn)} · {PLAYLIST_PROVIDER_LABEL[playlist.provider]}
                </span>
                {playlist.note ? <p className="whitespace-pre-wrap break-words text-ui text-secondary-foreground">{playlist.note}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {record.columns.length > 0 && record.tracks.length > 0 ? (
        <DiggingBoard
          heading={<h2 className="text-ui font-semibold text-secondary-foreground">트랙</h2>}
          initialColumns={record.columns.map((column) => ({ ...column, isDefault: column.isDefault ?? false, sortOrder: column.sortOrder ?? 0 }))}
          initialTracks={record.tracks}
          readonly
        />
      ) : null}
    </div>
  );
}

const BREADCRUMB_LINK_CLASS =
  "rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function AssignmentBody({ record }: { record: ArchivedAssignmentRecord }) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="제출" className="flex flex-col gap-2">
        {record.mediaUrl ? (
          <a
            href={record.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 max-w-full items-center gap-1.5 self-start rounded-touch border border-border px-3 text-ui text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7 md:rounded-md md:px-2.5 md:text-xs"
          >
            <Paperclip className="size-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <span className="truncate">{record.mediaUrl.startsWith("/") ? "제출 파일" : mediaSourceLabel(record.mediaUrl)}</span>
            <span className="sr-only">(새 창에서 열기)</span>
          </a>
        ) : null}
        {record.analysis ? (
          <>
            <MixAnalysisRating analysis={record.analysis} />
            {record.analysis.entries.length > 0 ? (
              <ul className="flex flex-col gap-1 text-body leading-6">
                {record.analysis.entries.map((entry, index) => (
                  <li key={index} className="flex gap-2.5">
                    <span className="w-12 shrink-0 font-mono text-xs leading-6 tabular-nums text-muted-foreground">
                      {entry.at === null ? "–" : formatAnalysisClock(entry.at)}
                    </span>
                    <span className="min-w-0 break-words">{entry.memo}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {record.textHtml ? <RichTextContent html={record.textHtml} className="text-body leading-6" /> : null}
      </section>
      <section aria-label="피드백" className="flex flex-col gap-1.5 border-t border-muted pt-3">
        <h3 className="text-xs font-normal text-muted-foreground">피드백</h3>
        {record.feedbacks.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-body leading-6">
            {record.feedbacks.map((feedback) => (
              <li key={feedback.id} className="flex gap-2.5">
                <span className="w-12 shrink-0 font-mono text-xs leading-6 tabular-nums text-muted-foreground">
                  {feedback.timeMarker === null ? "전체" : formatTimeRange(feedback.timeMarker, feedback.timeMarkerEnd, formatTimestamp)}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{feedback.content}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">{record.reviewedAt ? "피드백 없이 확인했습니다." : "피드백이 없습니다."}</p>
        )}
      </section>
    </div>
  );
}

export default async function ArchivedStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const { id: studentId } = await params;
  const { tab } = await searchParams;
  const activeTab = resolveArchivedRecordTab(tab);
  const records = await loadArchivedStudentRecords(studentId, activeTab);
  if (!records) {
    // 복원한 학생은 원래 학생 상세에서 본다.
    if (await getStudentById(studentId)) redirect(`/dashboard/admin/students/${encodeURIComponent(studentId)}`);
    notFound();
  }
  const now = new Date(getRequestNow());
  const dot = (value: Date | null) => (value ? formatKstDot(value, { referenceTime: now }) : "–");
  const { student, counts } = records;
  const emptyText = TABS.find((item) => item.key === activeTab)?.empty ?? "";

  return (
    <div className="px-5 pb-8 pt-4 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <div className="flex max-w-[880px] flex-col gap-4 md:mx-auto md:gap-6">
        <nav aria-label="위치" className="hidden items-center gap-1.5 text-xs md:flex">
          <Link href="/dashboard/admin?section=students" className={BREADCRUMB_LINK_CLASS}>학생</Link>
          <span aria-hidden="true" className="text-faint">/</span>
          <Link href="/dashboard/admin/students/archived" className={BREADCRUMB_LINK_CLASS}>수강 종료한 학생</Link>
        </nav>

        <header className="flex flex-col gap-2.5">
          <h1 className="break-words text-xl font-semibold tracking-title text-foreground md:text-2xl md:tracking-display">{student.name}</h1>
          <ArchivedStudentBanner
            studentId={student.id}
            name={student.name}
            archivedLabel={student.archivedAt ? dot(student.archivedAt) : null}
          />
        </header>

        <div className="flex flex-col">
          <nav aria-label="기록" className="scroll-row flex gap-5 overflow-x-auto border-b border-border text-body">
            {TABS.map(({ key, label }) => {
              const isActive = key === activeTab;
              return (
                <Link
                  key={key}
                  href={buildArchivedStudentHref(student.id, key)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex h-11 shrink-0 items-center whitespace-nowrap rounded-sm transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:h-9",
                    isActive
                      ? "font-medium text-foreground after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {isActive ? null : <TabPendingMark />}
                  <span className="ml-1.5 font-mono text-xs font-normal tabular-nums text-muted-foreground">
                    <span className="sr-only">, </span>
                    {counts[key]}
                    <span className="sr-only">개</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          {records.tab === "digging" ? (
            records.rows.tracks.length === 0 && records.rows.playlists.length === 0 && records.rows.feedbacks.length === 0 ? (
              <p className="py-4 text-body text-muted-foreground">{emptyText}</p>
            ) : (
              <DiggingRecords record={records.rows} />
            )
          ) : records.rows.length === 0 ? (
            <p className="py-4 text-body text-muted-foreground">{emptyText}</p>
          ) : (
            <ul aria-label={`${TABS.find((item) => item.key === activeTab)?.label ?? ""} 기록`} className="flex flex-col">
              {records.tab === "notes"
                ? records.rows.map((note) => (
                    <ArchivedRecordRow key={note.id} title={note.title || "제목 없음"} meta={dot(note.date)}>
                      {note.contentHtml.trim() ? (
                        <RichTextContent html={note.contentHtml} className="text-body leading-6" />
                      ) : (
                        <p className="text-body text-muted-foreground">내용이 없습니다.</p>
                      )}
                    </ArchivedRecordRow>
                  ))
                : records.tab === "assignments"
                  ? records.rows.map((record) => (
                      <ArchivedRecordRow key={record.id} title={record.title} meta={dot(record.submittedAt)}>
                        <AssignmentBody record={record} />
                      </ArchivedRecordRow>
                    ))
                  : records.rows.map((thread) => (
                      <ArchivedRecordRow key={thread.id} title={thread.title} meta={dot(thread.createdAt)}>
                        <ul
                          aria-label="질문과 답변"
                          // 펼친 칸이 아래 줄을 그으므로 마지막 답변은 줄을 긋지 않는다.
                          className="flex flex-col [&>li:first-child]:pt-0 [&>li:last-child]:border-b-0 [&>li:last-child]:pb-0"
                        >
                          {thread.replies.map((reply) => (
                            <ReplyCard key={reply.id} reply={reply} />
                          ))}
                        </ul>
                      </ArchivedRecordRow>
                    ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
