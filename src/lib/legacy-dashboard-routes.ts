export const STUDENT_LEGACY_REDIRECTS = {
  curriculum: "/dashboard/student?section=workspace&view=curriculum",
  assignments: "/dashboard/student?section=workspace&view=assignments",
  digging: "/dashboard/student?section=workspace&view=all&type=DIGGING",
} as const;

export function getLegacyCalendarRedirect(role: "admin" | "student"): string {
  return role === "admin"
    ? "/dashboard/admin?section=schedule&view=calendar"
    : "/dashboard/student?section=workspace&view=calendar";
}
