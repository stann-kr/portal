const ACCESS_DENIED_MESSAGES: ReadonlySet<string> = new Set(["Unauthorized", "Student not found"]);

/**
 * 볼 권한이 없는 문서는 오류 화면 대신 없는 문서처럼 다룬다(있다는 사실도 드러내지 않는다).
 * 권한 거부만 null로 바꾸고 다른 오류는 그대로 올려 오류 화면이 받게 한다.
 */
export async function missingWhenAccessDenied<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof Error && ACCESS_DENIED_MESSAGES.has(error.message)) return null;
    throw error;
  }
}
