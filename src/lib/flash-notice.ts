/**
 * 앱 안 이동 한 번에만 보여 줄 안내(예: 수강 종료 뒤 학생 목록 위 "○○의 수강을 종료했습니다.").
 * 브라우저 메모리에만 두므로 새로고침하면 사라진다. 이동 전에 넣고, 받는 화면이 처음 그릴 때 읽은 뒤 지운다.
 */
const notices = new Map<string, string>();

export const STUDENT_LIST_NOTICE_KEY = "admin-students";

export function setFlashNotice(key: string, message: string): void {
  notices.set(key, message);
}

/** 지우지 않고 읽는다(React가 초기값 함수를 두 번 부를 수 있어 지우기는 effect에서 한다). */
export function peekFlashNotice(key: string): string | null {
  return notices.get(key) ?? null;
}

export function clearFlashNotice(key: string): void {
  notices.delete(key);
}
