/**
 * 관리자 과제 내기 대상 고르기(캔버스 AdminUx1123 ①). 전체 과제(전체 학생)의 "과제 내기"와 위쪽 막대 +가 이 화면을 연다.
 * 학생을 고르면 그 학생 과제 탭의 "과제 내기" 폼을 펼친다. 같은 과제를 여러 학생에게 내려면 폼의 "다른 학생에게도 내기"를 쓴다.
 */
import { redirect } from "next/navigation";
import { CreateTargetPicker } from "@/components/admin/CreateTargetPicker";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getStudentRosterStats } from "@/lib/actions/students";
import { buildAdminAssignmentComposeHref } from "@/lib/admin-create-links";
import { buildCreateStudentTargets } from "@/lib/admin-create-targets";
import { getRequestNow } from "@/lib/request-time";
import { safeReturnPath } from "@/lib/safe-return-path";

export const metadata = { title: "과제 내기" };

const ASSIGNMENTS_HREF = "/dashboard/admin/assignments";

export default async function AdminAssignmentPickerPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const returnTo = safeReturnPath((await searchParams).returnTo, ASSIGNMENTS_HREF);
  const students = await getStudentRosterStats();

  return (
    <CreateTargetPicker
      pageTitle="과제 내기"
      heading="누구에게 과제를 낼까요?"
      hint="같은 과제를 여러 학생에게 내려면 폼의 '다른 학생에게도 내기'에서 더 고릅니다."
      back={{ href: returnTo, label: returnTo === ASSIGNMENTS_HREF ? "과제로" : "이전 화면으로" }}
      students={buildCreateStudentTargets(students, getRequestNow(), (id) => buildAdminAssignmentComposeHref(id, returnTo))}
    />
  );
}
