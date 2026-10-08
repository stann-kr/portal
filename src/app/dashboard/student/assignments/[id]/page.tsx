/**
 * @file src/app/dashboard/student/assignments/[id]/page.tsx
 * @description 과제 상세 페이지. VideoPlayer + 타임라인 피드백 (Server Component).
 * 데이터 패칭을 서버에서 처리하고, 복잡한 UI 상태는 클라이언트 컴포넌트로 위임합니다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
      <div className="mx-auto max-w-4xl px-4 py-6 text-center text-muted-foreground sm:px-6">
        <p>과제를 찾을 수 없습니다.</p>
        <Link href={returnTo} className="text-sm underline mt-2 block">
          이전 화면으로 돌아가기
        </Link>
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

  const submittedDate = formatKst(
    assignment.submittedAt,
    { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" },
    "제출일 미정",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          이전 화면으로 돌아가기
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {describeAssignmentMedia(assignment.mediaUrl)} 피드백
        </h1>
        <p className="text-sm text-muted-foreground">
          {student ? (
            <>
              <Link
                href={buildAdminStudentDetailHref(student.id, "overview")}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {getUnifiedItemSpaceLabel(student)}
              </Link>
              {" · "}
            </>
          ) : null}
          제출 {submittedDate}
        </p>
      </div>

      <AssignmentDetailClient
        key={assignmentId}
        assignmentId={assignmentId}
        actorId={session.user.id}
        mediaUrl={assignment.mediaUrl}
        feedbackList={feedbackList}
        isAdmin={isAdmin}
      />
    </div>
  );
}
