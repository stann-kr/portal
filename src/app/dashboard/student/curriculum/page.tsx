/**
 * @file src/app/dashboard/student/curriculum/page.tsx
 * @description canonical 학생 workspace 커리큘럼 view로 이동. 커리큘럼이 숨겨져 있으면 학생 캘린더로 이동.
 */
import { redirect } from "next/navigation";
import { getLegacyCurriculumRedirect } from "@/lib/legacy-dashboard-routes";

export default function CurriculumRedirectPage() {
  redirect(getLegacyCurriculumRedirect());
}
