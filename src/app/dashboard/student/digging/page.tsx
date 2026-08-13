/**
 * @file src/app/dashboard/student/digging/page.tsx
 * @description canonical 학생 workspace의 디깅 필터 view로 이동.
 */
import { redirect } from "next/navigation";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";

export default function DiggingRedirectPage() {
  redirect(STUDENT_LEGACY_REDIRECTS.digging);
}
