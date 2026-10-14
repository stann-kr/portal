/**
 * @file src/app/dashboard/student/curriculum/page.tsx
 * @description canonical 학생 workspace 커리큘럼 view로 이동.
 */
import { redirect } from "next/navigation";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";

export default function CurriculumRedirectPage() {
  redirect(STUDENT_LEGACY_REDIRECTS.curriculum);
}
