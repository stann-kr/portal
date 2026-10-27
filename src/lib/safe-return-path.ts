const LOCAL_ORIGIN = "https://portal.local";

/**
 * 같은 출처 경로만 돌려준다. 주소 query는 같은 이름이 반복되면 배열로 오므로 문자열이 아니면 fallback이다.
 */
export function safeReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, LOCAL_ORIGIN);
    if (parsed.origin !== LOCAL_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
