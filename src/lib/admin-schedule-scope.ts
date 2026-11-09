/**
 * 관리자 일정의 학생 선택 범위. `?student=all`이면 모든 활성 학생의 포탈 일정을 한 달력에 모은다(전체 학생).
 * 학생 id 대신 쓰는 값이라 실제 profile id(UUID)와 겹치지 않는다.
 */
export const ALL_STUDENTS_SCOPE = "all";

/**
 * 주소의 학생 값을 화면 선택으로 바꾼다. 있는 학생 id면 그 학생, 아니면(없음·`all`·지워진 학생) 전체 학생이다.
 * 학생이 하나도 없으면 빈 값이다.
 */
export function resolveAdminScheduleStudent(
  requested: string | null | undefined,
  studentIds: readonly string[],
): string {
  if (studentIds.length === 0) return "";
  if (requested && requested !== ALL_STUDENTS_SCOPE && studentIds.includes(requested)) return requested;
  return ALL_STUDENTS_SCOPE;
}
