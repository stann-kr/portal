/**
 * @file src/app/dashboard/admin/students/[id]/digging/page.tsx
 * @description 예전 관리자 학생 디깅 보드 주소. 학생 상세의 canonical 디깅 탭으로 이동한다.
 */
import { redirect } from "next/navigation";
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";

export default async function AdminStudentDiggingRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: studentId } = await params;
  redirect(buildAdminStudentDetailHref(studentId, "digging"));
}
