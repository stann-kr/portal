/**
 * DB 오류 판별. Drizzle·D1이 원인을 `cause`로 감싸 올리므로 몇 단계까지 따라가며 확인한다.
 */

function errorChainIncludes(error: unknown, text: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes(text)) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

/** unique index·primary key 충돌인지. 선검사를 지난 동시 요청을 안내 문구로 바꿀 때 쓴다. */
export function isUniqueViolation(error: unknown): boolean {
  return errorChainIncludes(error, "UNIQUE constraint failed");
}

/**
 * 같은 id·email의 profile이 이미 있어 INSERT가 막혔는지.
 * profiles에는 INSERT 전 trigger(`profiles_before_insert_existing`)가 있어 unique index보다 먼저 `PROFILE_DUPLICATE`로 막는다.
 */
export function isProfileDuplicate(error: unknown): boolean {
  return errorChainIncludes(error, "PROFILE_DUPLICATE") || isUniqueViolation(error);
}
