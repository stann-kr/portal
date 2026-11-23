/**
 * 관리자 디깅(캔버스 FlowGaps1123 ②). 사이드바 "디깅"이 이 화면을 연다.
 * 수강 중인 학생 전체(또는 `?student=`로 고른 한 명)가 디깅한 날을 최근 순으로 보이고, 날마다 트랙·플레이리스트 수와
 * 피드백 여부를 둔다. 줄을 누르면 학생 상세 디깅 탭의 그 날짜 줄로 가서 바로 피드백을 남긴다.
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";
import { ADMIN_DIGGING_HREF } from "@/components/app-shell/navigation";
import { formatDiggingDay } from "@/components/digging/DiggingFeedbackPanel";
import { NotesStudentFilter } from "@/components/notes/NotesStudentFilter";
import {
  LEDGER_HEADER_NOTE_CLASS,
  LEDGER_ROW_CLASS,
  LedgerEmptyRow,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";
import { getAdminDiggingOverview, type DiggingDay } from "@/lib/actions/digging-feedback";
import { ADMIN_LIST_FILTER_COOKIES, resolveRememberedStudent } from "@/lib/admin-list-filter-memory";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { toKstDateInputValue } from "@/lib/date-input";
import { firstSearchValue } from "@/lib/portal-location";
import { STATUS_TONE_DOT_CLASS_NAMES } from "@/lib/portal-status";
import { getRequestNow } from "@/lib/request-time";
import { buildAdminStudentDetailHref, diggingFeedbackAnchorId } from "@/lib/student-space-routes";
import { cn } from "@/lib/utils";

export const metadata = { title: "디깅" };

const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_CLASS = cn(
  LEDGER_ROW_CLASS,
  "flex flex-wrap items-center gap-x-3 gap-y-0.5 py-3 md:h-13 md:flex-nowrap md:px-1 md:py-0",
);

function counts(day: DiggingDay): string {
  const parts = [
    day.trackCount > 0 ? `트랙 ${day.trackCount}` : null,
    day.playlistCount > 0 ? `플레이리스트 ${day.playlistCount}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "피드백만 남음";
}

function DayRow({ day, studentLabel }: { day: DiggingDay; studentLabel: string }) {
  const href = `${buildAdminStudentDetailHref(day.studentId, "digging")}#${diggingFeedbackAnchorId(day.dugOn)}`;
  const done = day.feedback !== null;
  return (
    <li>
      <Link href={href} className={ROW_CLASS}>
        <span className="min-w-0 basis-full truncate text-md font-medium md:flex-1 md:basis-auto md:text-body">{formatDiggingDay(day.dugOn)}</span>
        <span className="truncate text-ui text-secondary-foreground md:order-first md:w-20 md:shrink-0">{studentLabel}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{counts(day)}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui text-secondary-foreground md:w-28">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS_NAMES[done ? "success" : "warning"])} />
          {done ? "피드백 남김" : "피드백 전"}
        </span>
      </Link>
    </li>
  );
}

export default async function AdminDiggingPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student/digging");

  const params = await searchParams;
  const { students, selectedStudentId, days } = await getAdminDiggingOverview({
    studentId: resolveRememberedStudent(firstSearchValue(params.student), (await cookies()).get(ADMIN_LIST_FILTER_COOKIES.digging)?.value),
  });
  const labels = new Map(students.map((student) => [student.id, student.label]));
  const label = (id: string) => labels.get(id) ?? "학생";
  const selectedLabel = selectedStudentId ? label(selectedStudentId) : null;

  const waiting = days.filter((day) => day.feedback === null);
  const done = days.filter((day) => day.feedback !== null);
  // 최근 7일(오늘 포함, KST 날짜) 동안 넣은 트랙 수.
  const today = toKstDateInputValue(new Date(getRequestNow()));
  const weekStart = toKstDateInputValue(new Date(Date.parse(`${today}T00:00:00+09:00`) - 6 * DAY_MS));
  const weekTracks = days.filter((day) => day.dugOn >= weekStart).reduce((sum, day) => sum + day.trackCount, 0);
  const metrics = [
    { label: "피드백 전", value: waiting.length, alert: waiting.length > 0 },
    { label: "최근 7일 트랙", value: weekTracks },
    { label: "디깅한 날", value: days.length },
  ];

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="디깅" />
      {/* 학생이 트랙·플레이리스트를 넣거나 다른 탭에서 피드백하면 돌아올 때 목록을 다시 받는다. */}
      <RouteAutoRefresh />
      <div className="flex max-w-[1080px] flex-col gap-5 md:mx-auto md:gap-7">
        <header className="flex flex-col gap-1 max-md:sr-only">
          <p className="hidden text-xs text-muted-foreground md:block">{selectedLabel ?? "전체 학생"}</p>
          <h1 className="sr-only text-display font-semibold tracking-display text-foreground md:not-sr-only">디깅</h1>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 md:border-b md:border-border md:pb-3">
          <NotesStudentFilter action={ADMIN_DIGGING_HREF} students={students} selectedStudentId={selectedStudentId} query="" remember="digging" />
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-ui">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex gap-2">
                <dt className="text-muted-foreground">{metric.label}</dt>
                <dd className={cn("font-mono font-medium tabular-nums", metric.alert && "text-warning")}>{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <LedgerSection labelledBy="admin-digging-waiting-heading">
          <LedgerSectionHeader
            id="admin-digging-waiting-heading"
            title="피드백 전"
            count={waiting.length}
            aside={<span className={cn(LEDGER_HEADER_NOTE_CLASS, "hidden md:inline")}>최근 디깅한 날 순</span>}
          />
          {waiting.length === 0 ? (
            <LedgerEmptyRow>
              {days.length === 0 ? "아직 디깅한 학생이 없습니다." : "모든 디깅에 피드백을 남겼습니다."}
            </LedgerEmptyRow>
          ) : (
            <ul>{waiting.map((day) => <DayRow key={`${day.studentId}:${day.dugOn}`} day={day} studentLabel={label(day.studentId)} />)}</ul>
          )}
        </LedgerSection>

        <LedgerSection labelledBy="admin-digging-done-heading">
          <LedgerSectionHeader id="admin-digging-done-heading" title="피드백 남긴 날" count={done.length} />
          {done.length === 0 ? (
            <LedgerEmptyRow>아직 피드백을 남긴 날이 없습니다.</LedgerEmptyRow>
          ) : (
            <ul>{done.map((day) => <DayRow key={`${day.studentId}:${day.dugOn}`} day={day} studentLabel={label(day.studentId)} />)}</ul>
          )}
        </LedgerSection>
      </div>
    </div>
  );
}
