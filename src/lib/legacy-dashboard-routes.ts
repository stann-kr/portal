import { isCurriculumVisible } from "@/lib/curriculum-visibility";

export const STUDENT_LEGACY_REDIRECTS = {
  curriculum: "/dashboard/student?section=workspace&view=curriculum",
  assignments: "/dashboard/student?section=workspace&view=assignments",
} as const;

/** 예전 `/dashboard/student/curriculum` 주소. 커리큘럼이 숨겨져 있으면 학생 캘린더로 보낸다. */
export function getLegacyCurriculumRedirect(curriculumVisible = isCurriculumVisible()): string {
  return curriculumVisible ? STUDENT_LEGACY_REDIRECTS.curriculum : getLegacyCalendarRedirect("student");
}

export function getLegacyCalendarRedirect(role: "admin" | "student"): string {
  return role === "admin"
    ? "/dashboard/admin?section=schedule&view=calendar"
    : "/dashboard/student?section=workspace&view=calendar";
}
