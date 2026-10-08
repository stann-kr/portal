/**
 * @file src/app/dashboard/student/assignments/[id]/page.tsx
 * @description 과제 상세 페이지. VideoPlayer + 타임라인 피드백 (Server Component).
 * 데이터 패칭을 서버에서 처리하고, 복잡한 UI 상태는 클라이언트 컴포넌트로 위임합니다.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAssignmentById } from "@/lib/actions/assignments";
import { getFeedbacksByAssignment } from "@/lib/actions/feedbacks";
import { requireAuth } from "@/lib/auth-guard";
import { AssignmentDetailClient } from "./AssignmentDetailClient";
import { formatKst } from "@/lib/kst-format";

export type AssignmentFeedback = Awaited<
  ReturnType<typeof getFeedbacksByAssignment>
>[number];

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: assignmentId } = await params;

  const [assignment, fb, session] = await Promise.all([
    getAssignmentById(assignmentId),
    getFeedbacksByAssignment(assignmentId),
    requireAuth(),
  ]);

  if (!assignment) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 text-center text-muted-foreground sm:px-6">
        <p>과제를 찾을 수 없습니다.</p>
        <Link
          href="/dashboard/student/assignments"
          className="text-sm underline mt-2 block"
        >
          목록으로
        </Link>
      </div>
    );
  }

  const feedbackList = fb.map((f: AssignmentFeedback) => ({
    id: f.id,
    timeMarker: f.timeMarker,
    content: f.content,
    createdAt: f.createdAt,
  }));
  const isAdmin = session?.user?.role === "admin";

  const submittedDate = formatKst(
    assignment.submittedAt,
    { year: "numeric", month: "long", day: "numeric" },
    "제출일 미정",
  );
  const backHref = isAdmin ? "/dashboard/admin?section=work" : "/dashboard/student?section=today";
  const backLabel = isAdmin ? "업무함으로" : "학생 포털로";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          믹스셋 피드백
        </h1>
        <p className="text-sm text-muted-foreground">제출일: {submittedDate}</p>
      </div>

      <AssignmentDetailClient
        key={assignmentId}
        assignmentId={assignmentId}
        actorId={session.user.id!}
        mediaUrl={assignment.mediaUrl}
        feedbackList={feedbackList}
        isAdmin={isAdmin}
      />
    </div>
  );
}
