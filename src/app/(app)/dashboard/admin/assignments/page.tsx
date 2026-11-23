/**
 * 관리자 전체 과제(캔버스 AdminAssignments, 2026-11-23). 사이드바 "과제"와 업무함 피드백 대기의 "전체 과제"가 이 화면으로 온다.
 * 수강 중인 학생 전체(또는 `?student=`로 고른 한 명)의 피드백 대기 · 아직 안 낸 과제 · 최근 확인한 제출을 한 화면에 둔다.
 * "과제 내기"는 학생을 골라 둔 상태면 그 학생 과제 탭의 폼을 바로 열고, 전체 학생이면 대상 고르기 화면을 연다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { RouteAutoRefresh } from "@/components/app-shell/RouteAutoRefresh";
import { ADMIN_ASSIGNMENT_PICKER_HREF, ADMIN_ASSIGNMENTS_HREF } from "@/components/app-shell/navigation";
import { NotesStudentFilter } from "@/components/notes/NotesStudentFilter";
import {
  LEDGER_HEADER_NOTE_CLASS,
  LEDGER_ROW_CLASS,
  LedgerEmptyRow,
  LedgerSection,
  LedgerSectionHeader,
} from "@/components/student-portal/today/HomeSection";
import { buttonClassName } from "@/components/ui/button";
import { getAdminAssignmentsOverview } from "@/lib/actions/admin-assignments";
import { buildAssignmentQueueHref } from "@/lib/admin-work-queue";
import { buildAdminAssignmentComposeHref } from "@/lib/admin-create-links";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { toKstDateInputValue } from "@/lib/date-input";
import { formatKstDot } from "@/lib/kst-format";
import { firstSearchValue } from "@/lib/portal-location";
import { STATUS_TONE_DOT_CLASS_NAMES, type PortalStatusTone } from "@/lib/portal-status";
import { getRequestNow } from "@/lib/request-time";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";
import { cn } from "@/lib/utils";

export const metadata = { title: "과제" };

const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_CLASS = cn(
  LEDGER_ROW_CLASS,
  "flex flex-wrap items-center gap-x-3 gap-y-0.5 py-3 md:h-13 md:flex-nowrap md:px-1 md:py-0",
);

function RowStudent({ children }: { children: string }) {
  return <span className="truncate text-ui text-secondary-foreground md:order-first md:w-20 md:shrink-0">{children}</span>;
}

function RowTitle({ children }: { children: string }) {
  return <span className="min-w-0 basis-full truncate text-md font-medium md:flex-1 md:basis-auto md:text-body">{children}</span>;
}

function StatusDot({ tone, label }: { tone: PortalStatusTone; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui text-secondary-foreground md:w-24">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE_DOT_CLASS_NAMES[tone])} />
      {label}
    </span>
  );
}

/** 아직 안 낸 과제의 상태: 마감 지남 · 오늘/내일 마감(KST 날짜 기준) · 진행 중 · 마감 없음. */
function openTaskStatus(dueAt: Date | null, now: Date): { tone: PortalStatusTone; label: string } {
  if (!dueAt) return { tone: "neutral", label: "마감 없음" };
  if (dueAt.getTime() < now.getTime()) return { tone: "destructive", label: "마감 지남" };
  const days = Math.round((Date.parse(toKstDateInputValue(dueAt)) - Date.parse(toKstDateInputValue(now))) / DAY_MS);
  if (days <= 0) return { tone: "warning", label: "오늘 마감" };
  if (days === 1) return { tone: "warning", label: "내일 마감" };
  return { tone: "neutral", label: "진행 중" };
}

export default async function AdminAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string | string[] }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const params = await searchParams;
  const referenceTime = new Date(getRequestNow());
  const now = referenceTime.getTime();
  const { students, selectedStudentId, pending, open, reviewed } = await getAdminAssignmentsOverview(
    { studentId: firstSearchValue(params.student) },
    referenceTime,
  );
  const labels = new Map(students.map((student) => [student.id, student.label]));
  const label = (id: string) => labels.get(id) ?? "학생";
  const returnTo = selectedStudentId
    ? `${ADMIN_ASSIGNMENTS_HREF}?student=${encodeURIComponent(selectedStudentId)}`
    : ADMIN_ASSIGNMENTS_HREF;
  const selectedLabel = selectedStudentId ? label(selectedStudentId) : null;
  const compose = selectedStudentId
    ? { href: buildAdminAssignmentComposeHref(selectedStudentId, returnTo), label: `${selectedLabel} 과제 내기` }
    : { href: ADMIN_ASSIGNMENT_PICKER_HREF, label: "과제 내기" };
  const overdueCount = open.filter((task) => task.dueAt && task.dueAt.getTime() < now).length;
  const metrics = [
    { label: "피드백 대기", value: pending.length },
    { label: "마감 지남", value: overdueCount, alert: overdueCount > 0 },
    { label: "아직 안 냄", value: open.length },
  ];

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="과제" action={compose} />
      {/* 학생이 제출하거나 다른 화면에서 피드백하면 돌아올 때 목록을 다시 받는다. */}
      <RouteAutoRefresh />
      <div className="flex max-w-[1080px] flex-col gap-5 md:mx-auto md:gap-7">
        <header className="flex flex-wrap items-end justify-between gap-4 max-md:sr-only">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="hidden text-xs text-muted-foreground md:block">{selectedLabel ?? "전체 학생"}</p>
            <h1 className="sr-only text-display font-semibold tracking-display text-foreground md:not-sr-only">과제</h1>
          </div>
          <Link href={compose.href} aria-label={compose.label} className={buttonClassName({ className: "hidden md:inline-flex" })}>
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />과제 내기
          </Link>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 md:border-b md:border-border md:pb-3">
          <NotesStudentFilter action={ADMIN_ASSIGNMENTS_HREF} students={students} selectedStudentId={selectedStudentId} query="" />
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-ui">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex gap-2">
                <dt className="text-muted-foreground">{metric.label}</dt>
                <dd className={cn("font-mono font-medium tabular-nums", metric.alert && "text-destructive")}>{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <LedgerSection labelledBy="admin-pending-heading">
          <LedgerSectionHeader
            id="admin-pending-heading"
            title="피드백 대기"
            count={pending.length}
            aside={<span className={cn(LEDGER_HEADER_NOTE_CLASS, "hidden md:inline")}>오래된 제출 순</span>}
          />
          {pending.length === 0 ? (
            <LedgerEmptyRow>피드백 대기가 없습니다. 모든 제출을 처리했습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {pending.map((submission) => {
                const submitted = formatKstDot(submission.submittedAt, { referenceTime });
                return (
                  <li key={submission.id}>
                    {/* 업무함과 같이 피드백·확인 뒤 다음 피드백 대기로 이어 주고, 끝나면 이 화면으로 돌아온다. */}
                    <Link href={buildAssignmentQueueHref(submission.id, returnTo)} className={ROW_CLASS}>
                      <RowTitle>{submission.title}</RowTitle>
                      <RowStudent>{label(submission.studentId)}</RowStudent>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{submitted ? `${submitted} 제출` : "제출일 미정"}</span>
                      <span className="shrink-0 text-ui text-foreground underline underline-offset-4 max-md:hidden">제출 보고 피드백</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </LedgerSection>

        <LedgerSection labelledBy="admin-open-heading">
          <LedgerSectionHeader
            id="admin-open-heading"
            title="아직 안 낸 과제"
            count={open.length}
            aside={<span className={cn(LEDGER_HEADER_NOTE_CLASS, "hidden md:inline")}>마감이 가까운 순</span>}
          />
          {open.length === 0 ? (
            <LedgerEmptyRow>낸 과제를 모두 제출했습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {open.map((task) => {
                const status = openTaskStatus(task.dueAt, referenceTime);
                const due = task.dueAt ? `${formatKstDot(task.dueAt, { weekday: true, referenceTime })} 마감` : "마감 없음";
                return (
                  <li key={task.id}>
                    <Link href={buildAdminStudentDetailHref(task.studentId, "assignments")} className={ROW_CLASS}>
                      <RowTitle>{task.title}</RowTitle>
                      <RowStudent>{label(task.studentId)}</RowStudent>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{due}</span>
                      <StatusDot tone={status.tone} label={status.label} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </LedgerSection>

        <LedgerSection labelledBy="admin-reviewed-heading">
          <LedgerSectionHeader
            id="admin-reviewed-heading"
            title="최근 확인한 제출"
            count={reviewed.length}
            aside={<span className={cn(LEDGER_HEADER_NOTE_CLASS, "hidden md:inline")}>최근 30일</span>}
          />
          {reviewed.length === 0 ? (
            <LedgerEmptyRow>최근 30일 동안 확인한 제출이 없습니다.</LedgerEmptyRow>
          ) : (
            <ul>
              {reviewed.map((submission) => {
                const submitted = formatKstDot(submission.submittedAt, { referenceTime });
                return (
                  <li key={submission.id}>
                    <Link
                      href={`/dashboard/student/assignments/${encodeURIComponent(submission.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                      className={ROW_CLASS}
                    >
                      <RowTitle>{submission.title}</RowTitle>
                      <RowStudent>{label(submission.studentId)}</RowStudent>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{submitted ? `${submitted} 제출` : "제출일 미정"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </LedgerSection>
      </div>
    </div>
  );
}
