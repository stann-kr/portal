/**
 * @file src/app/dashboard/student/assignments/page.tsx
 * @description canonical 학생 workspace 과제 view로 이동.
 */
import { redirect } from "next/navigation";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";

export default function AssignmentsRedirectPage() {
  redirect(STUDENT_LEGACY_REDIRECTS.assignments);
}
