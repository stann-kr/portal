/**
 * 홈 화면 웹앱(manifest·theme-color meta)이 쓰는 색. CSS 변수를 읽을 수 없는 자리라 값을 직접 둔다.
 * globals.css의 --color-background(밝게 #ffffff·어둡게 #0f0f11)와 같은 값을 유지한다.
 */
export const WEB_APP_BACKGROUND = {
  light: "#ffffff",
  dark: "#0f0f11",
} as const;

/** 계정 메뉴의 '화면 모드'. system은 기기 설정(prefers-color-scheme)을 따른다. */
export type ThemePreference = "system" | "light" | "dark";
export type ExplicitTheme = Exclude<ThemePreference, "system">;

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * 이 기기에 저장하는 화면 모드 cookie. 서버 layout이 읽어 첫 HTML의 `<html data-theme>`과 theme-color를
 * 고른 모드로 그리므로 새로 열어도 다른 모드가 먼저 보이지 않는다. system이면 cookie를 지운다.
 */
export const THEME_COOKIE = "portal-theme";
/** 1년. 다시 고르지 않으면 이 기기에서 계속 같은 모드로 연다. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** cookie 값에서 수동 모드만 받는다. 없거나 모르는 값은 null(= 시스템). */
export function parseThemeCookie(value: string | null | undefined): ExplicitTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** `document.cookie`에 그대로 쓰는 문자열. system은 같은 이름·경로를 만료시켜 지운다. */
export function serializeThemeCookie(preference: ThemePreference, { secure = false }: { secure?: boolean } = {}): string {
  const suffix = `; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  if (preference === "system") return `${THEME_COOKIE}=; Max-Age=0${suffix}`;
  return `${THEME_COOKIE}=${preference}; Max-Age=${THEME_COOKIE_MAX_AGE}${suffix}`;
}

/** `document.cookie` 전체 문자열에서 화면 모드 cookie를 찾는다. */
export function readThemeCookie(cookieHeader: string | null | undefined): ExplicitTheme | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== THEME_COOKIE) continue;
    return parseThemeCookie(part.slice(separator + 1).trim());
  }
  return null;
}

/**
 * viewport theme-color. 수동 모드면 그 색 하나, 시스템이면 기기 설정별 두 색.
 */
export function themeColorsFor(theme: ExplicitTheme | null): { media?: string; color: string }[] {
  if (theme) return [{ color: WEB_APP_BACKGROUND[theme] }];
  return [
    { media: "(prefers-color-scheme: light)", color: WEB_APP_BACKGROUND.light },
    { media: "(prefers-color-scheme: dark)", color: WEB_APP_BACKGROUND.dark },
  ];
}
