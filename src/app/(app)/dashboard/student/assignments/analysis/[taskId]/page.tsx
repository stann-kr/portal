/**
 * @file src/app/(app)/dashboard/student/assignments/analysis/[taskId]/page.tsx
 * @description 믹스셋 분석 쓰기·고치기(AnalysisWrite·MobileAnalysisWrite 보드). 학생 본인의 분석 과제만 연다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { AssignmentBrief } from "@/components/student-portal/AssignmentBrief";
import { MixAnalysisWriteForm } from "@/components/student-portal/MixAnalysisWriteForm";
import { getMyAssignmentTask } from "@/lib/actions/assignmentTasks";
import { ASSIGNMENT_FORMAT_LABELS } from "@/lib/assignment-recurrence";
import { isSubmissionSettled } from "@/lib/assignment-submission";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { formatKst } from "@/lib/kst-format";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";

export const metadata = { title: "믹스셋 분석" };

const LIST_HREF = STUDENT_LEGACY_REDIRECTS.assignments;

function detailHref(assignmentId: string): string {
  return `/dashboard/student/assignments/${encodeURIComponent(assignmentId)}?returnTo=${encodeURIComponent(LIST_HREF)}`;
}

export default async function MixAnalysisWritePage({ params }: { params: Promise<{ taskId: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { taskId } = await params;
  // 관리자·다른 학생의 과제·없는 과제는 같은 안내로 둔다.
  const task = session.user.role === "student" ? await getMyAssignmentTask(taskId).catch(() => null) : null;
  const unavailable = !task || task.submissionFormat !== "ANALYSIS"
    ? "분석을 쓸 과제를 찾을 수 없습니다."
    : task.submission && isSubmissionSettled(task.submission)
      ? task.submission.feedbackCount > 0 ? "피드백이 달린 분석은 고칠 수 없습니다." : "Stann이 확인한 분석은 고칠 수 없습니다."
      : null;

  if (!task || unavailable) {
    return (
      <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
        <MobileTopBar title="믹스셋 분석" back={{ href: LIST_HREF, label: "과제 목록으로" }} />
        <div className="flex max-w-[880px] flex-col items-start gap-2 md:mx-auto">
          <p className="text-body text-secondary-foreground">{unavailable}</p>
          <Link
            href={task?.submission ? detailHref(task.submission.id) : LIST_HREF}
            className="inline-flex min-h-11 items-center text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground md:min-h-0"
          >
            {task?.submission ? "피드백 보기" : "과제 목록으로 돌아가기"}
          </Link>
        </div>
      </div>
    );
  }

  const time = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const dueLabel = task.dueAt
    ? `${formatKst(task.dueAt, { month: "long", day: "numeric", weekday: "short", ...time })} 마감`
    : "마감 없음";

  return (
    <div className="flex flex-col md:gap-7 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <MobileTopBar title="믹스셋 분석" back={{ href: LIST_HREF, label: "과제 목록으로" }} />
      <nav aria-label="위치" className="hidden min-w-0 items-center gap-1.5 text-ui md:flex">
        <Link
          href={LIST_HREF}
          className="shrink-0 rounded-sm text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          과제
        </Link>
        <span aria-hidden="true" className="text-faint">/</span>
        <span aria-current="page" className="truncate text-foreground">{task.title}</span>
      </nav>
      <header className="hidden flex-col gap-1 md:flex">
        <h1 className="text-display font-semibold tracking-display">{task.title}</h1>
        <p className="text-ui text-muted-foreground">{dueLabel} · {ASSIGNMENT_FORMAT_LABELS.ANALYSIS}</p>
      </header>
      {/* Stann의 과제 설명: 넓은 화면은 머리 아래, 좁은 화면은 폼의 제목 아래(MixAnalysisWriteForm)에 처음부터 펼쳐 둔다. */}
      {task.descriptionHtml ? <AssignmentBrief html={task.descriptionHtml} open className="hidden max-w-[880px] md:block" /> : null}
      <MixAnalysisWriteForm
        key={task.submission?.id ?? task.id}
        task={task}
        actorId={session.user.id}
        dueLabel={dueLabel}
        backHref={LIST_HREF}
      />
    </div>
  );
}
