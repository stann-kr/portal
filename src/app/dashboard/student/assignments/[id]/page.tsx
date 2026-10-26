/**
 * @file src/app/dashboard/student/assignments/[id]/page.tsx
 * @description 과제 상세 페이지(AssignmentDetail·MobileAssignment 보드). 플레이어 + 타임라인 피드백 (Server Component).
 * 데이터 패칭과 소유권 확인은 서버에서 처리하고, 화면 배치와 상호작용은 클라이언트 컴포넌트로 위임합니다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAssignmentById } from "@/lib/actions/assignments";
import { getFeedbacksByAssignment } from "@/lib/actions/feedbacks";
import { getStudentById } from "@/lib/actions/students";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { AssignmentDetailClient } from "./AssignmentDetailClient";
import { formatKst } from "@/lib/kst-format";
import { safeReturnPath } from "@/lib/safe-return-path";
import { describeAssignmentMedia, getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";

export type AssignmentFeedback = Awaited<
  ReturnType<typeof getFeedbacksByAssignment>
>[number];

export const metadata = { title: "과제 피드백" };

export default async function AssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");

  const { id: assignmentId } = await params;
  const isAdmin = session.user.role === "admin";
  const fallback = isAdmin ? "/dashboard/admin?section=work" : "/dashboard/student?section=workspace&view=assignments";
  const returnTo = safeReturnPath((await searchParams).returnTo, fallback);

  // 다른 학생의 과제와 없는 과제를 같은 화면으로 처리해 존재 여부를 드러내지 않는다.
  const assignment = await getAssignmentById(assignmentId).catch(() => null);
  if (!assignment) {
    return (
      <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
        <div className="flex max-w-[880px] flex-col items-start gap-2">
          <p className="text-body text-secondary-foreground">과제를 찾을 수 없습니다.</p>
          <Link
            href={returnTo}
            className="inline-flex min-h-11 items-center text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground md:min-h-0"
          >
            이전 화면으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const [fb, student] = await Promise.all([
    getFeedbacksByAssignment(assignmentId),
    isAdmin ? getStudentById(assignment.studentId) : Promise.resolve(null),
  ]);

  const feedbackList = fb.map((f: AssignmentFeedback) => ({
    id: f.id,
    timeMarker: f.timeMarker,
    content: f.content,
    createdAt: f.createdAt,
  }));

  const time = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const submittedLabel = assignment.submittedAt
    ? `${formatKst(assignment.submittedAt, { year: "numeric", month: "long", day: "numeric", ...time })} 제출`
    : "제출일 미정";
  const submittedLabelShort = assignment.submittedAt
    ? `${formatKst(assignment.submittedAt, { month: "long", day: "numeric", ...time })} 제출`
    : "제출일 미정";
  const spaceLink = student
    ? { href: buildAdminStudentDetailHref(student.id, "assignments"), label: getUnifiedItemSpaceLabel(student) }
    : undefined;

  return (
    <AssignmentDetailClient
      key={assignmentId}
      assignmentId={assignmentId}
      actorId={session.user.id}
      mediaUrl={assignment.mediaUrl}
      feedbackList={feedbackList}
      isAdmin={isAdmin}
      deleteReturnTo={!isAdmin && assignment.studentId === session.user.id ? returnTo : undefined}
      title={describeAssignmentMedia(assignment.mediaUrl)}
      submittedLabel={submittedLabel}
      submittedLabelShort={submittedLabelShort}
      // 위치 표시는 계층(학생: 과제 목록), 위쪽 막대의 뒤로는 들어온 화면(returnTo)이다.
      breadcrumb={isAdmin ? { href: returnTo, label: "이전 화면" } : { href: fallback, label: "과제" }}
      returnTo={returnTo}
      spaceLink={spaceLink}
    />
  );
}
