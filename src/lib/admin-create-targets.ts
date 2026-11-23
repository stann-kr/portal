/** 대상 고르기 한 줄. */
export type CreateTarget = { id: string; label: string; meta: string; href: string };
import { formatKstDot } from "@/lib/kst-format";
import type { StudentRosterStat } from "@/lib/student-roster";

/**
 * 대상 고르기의 학생 줄: 다음 레슨이 가까운 학생 먼저, 예정 레슨이 없는 학생은 이름순으로 뒤에 둔다.
 * 수업 직후·직전에 노트를 쓰는 일이 가장 잦아 그 학생이 맨 위에 오게 한다.
 */
export function buildCreateStudentTargets(
  students: readonly StudentRosterStat[],
  now: number,
  hrefOf: (studentId: string) => string,
): CreateTarget[] {
  const label = (student: StudentRosterStat) => student.displayName?.trim() || student.email;
  const upcoming = (student: StudentRosterStat) =>
    student.nextLessonDate && student.nextLessonDate.getTime() >= now ? student.nextLessonDate.getTime() : null;
  return [...students]
    .sort((a, b) => {
      const at = upcoming(a);
      const bt = upcoming(b);
      if (at !== null && bt !== null) return at - bt;
      if (at !== null) return -1;
      if (bt !== null) return 1;
      return label(a).localeCompare(label(b), "ko");
    })
    .map((student) => {
      const next = upcoming(student);
      return {
        id: student.id,
        label: label(student),
        meta: next !== null ? `다음 레슨 ${formatKstDot(new Date(next), { referenceTime: new Date(now) })}` : "예정 레슨 없음",
        href: hrefOf(student.id),
      };
    });
}
