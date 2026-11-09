/**
 * @file src/app/dashboard/student/assignments/page.tsx
 * @description canonical 학생 workspace 과제 view로 이동. `?task=<id>`는 형식만 확인해 넘기고,
 * 현재 학생의 과제인지는 학생 포탈 page가 과제 목록과 대조한다.
 */
import { redirect } from "next/navigation";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
import { firstSearchValue, parseDeepLinkId, type PortalSearchParams } from "@/lib/portal-location";

export default async function AssignmentsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<PortalSearchParams>;
}) {
  const taskId = parseDeepLinkId(firstSearchValue((await searchParams).task));
  redirect(
    taskId
      ? `${STUDENT_LEGACY_REDIRECTS.assignments}&task=${encodeURIComponent(taskId)}`
      : STUDENT_LEGACY_REDIRECTS.assignments,
  );
}
