/**
 * 커리큘럼 기능 노출 스위치.
 * 아직 정규화된 커리큘럼이 없어 학생·관리자 화면에서 모두 숨긴다(2026-10-27 사용자 결정).
 * 코드·DB·server action·데이터는 그대로 두므로, 다시 보이려면 아래 값을 true로 바꾸면 된다.
 */
const CURRICULUM_VISIBLE = false;

/** 커리큘럼 메뉴·보기·관리 화면을 보여도 되는지. 테스트는 인자로 두 상태를 모두 확인한다. */
export function isCurriculumVisible(value: boolean = CURRICULUM_VISIBLE): boolean {
  return value;
}
