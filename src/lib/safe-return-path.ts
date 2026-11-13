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
    // "/.//host"처럼 점 세그먼트가 사라지면 "//host"가 되어 다른 출처로 열린다.
    if (parsed.pathname.startsWith("//")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
