/**
 * 관리자 새 노트 대상 고르기(캔버스 AdminUx1123 ①). 전체 노트(전체 학생)의 "새 노트"와 위쪽 막대 +가 이 화면을 연다.
 * 그룹을 고르면 첫 멤버의 composer를 그룹 노트로, 학생을 고르면 그 학생 노트로 연다. 일정 머리 더 보기의 "새 노트"(전체 학생)도 이 화면을 연다. 저장하거나 닫으면 연 화면(`returnTo`)으로 돌아온다.
 */
import { redirect } from "next/navigation";
import { CreateTargetPicker, type CreateTarget } from "@/components/admin/CreateTargetPicker";
import { resolveNoteParent } from "@/components/notes/NoteDocumentChrome";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getLessonGroups } from "@/lib/actions/lessonGroups";
import { getStudentRosterStats } from "@/lib/actions/students";
import { buildAdminNoteComposeHref } from "@/lib/admin-create-links";
import { buildCreateStudentTargets } from "@/lib/admin-create-targets";
import { getRequestNow } from "@/lib/request-time";
import { safeReturnPath } from "@/lib/safe-return-path";

export const metadata = { title: "새 노트" };

const NOTES_HREF = "/dashboard/admin/notes";

export default async function AdminNewNotePickerPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard/student");

  const returnTo = safeReturnPath((await searchParams).returnTo, NOTES_HREF);
  const [students, groups] = await Promise.all([getStudentRosterStats(), getLessonGroups()]);
  const names = new Map(students.map((student) => [student.id, student.displayName?.trim() || student.email]));
  const groupTargets: CreateTarget[] = groups.flatMap((group) => {
    // 수강 중인 멤버만 센다. 멤버가 없으면 composer를 열 학생이 없어 줄을 두지 않는다.
    const members = group.memberIds.filter((id) => names.has(id));
    if (members.length === 0) return [];
    return [{
      id: group.id,
      label: group.name,
      meta: members.map((id) => names.get(id)).join(" · "),
      href: buildAdminNoteComposeHref(members[0], { group: true, returnTo }),
    }];
  });

  return (
    <CreateTargetPicker
      pageTitle="새 노트"
      heading="누구의 노트를 쓸까요?"
      back={{ href: returnTo, label: resolveNoteParent(returnTo).backLabel }}
      groups={groupTargets}
      students={buildCreateStudentTargets(students, getRequestNow(), (id) => buildAdminNoteComposeHref(id, { returnTo }))}
    />
  );
}
