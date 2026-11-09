import assert from "node:assert/strict";
import test from "node:test";
import {
  parseThemeCookie,
  readThemeCookie,
  serializeThemeCookie,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeColorsFor,
  WEB_APP_BACKGROUND,
} from "./web-app-theme";

test("화면 모드 cookie는 light·dark만 받고 그 밖의 값은 시스템(null)이다", () => {
  assert.equal(parseThemeCookie("light"), "light");
  assert.equal(parseThemeCookie("dark"), "dark");
  for (const value of [undefined, null, "", "system", "DARK", "dark ", "auto"]) {
    assert.equal(parseThemeCookie(value), null, String(value));
  }
});

test("화면 모드 저장 문자열: 수동 모드는 1년 저장, 시스템은 같은 이름·경로를 지운다", () => {
  assert.equal(
    serializeThemeCookie("dark"),
    `${THEME_COOKIE}=dark; Max-Age=${THEME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`,
  );
  assert.equal(
    serializeThemeCookie("light", { secure: true }),
    `${THEME_COOKIE}=light; Max-Age=${THEME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax; Secure`,
  );
  assert.equal(serializeThemeCookie("system"), `${THEME_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`);
});

test("document.cookie 문자열에서 화면 모드만 읽는다", () => {
  assert.equal(readThemeCookie(`a=1; ${THEME_COOKIE}=dark; b=2`), "dark");
  assert.equal(readThemeCookie(`${THEME_COOKIE}-x=dark; ${THEME_COOKIE}=light`), "light");
  assert.equal(readThemeCookie(`x${THEME_COOKIE}=dark`), null);
  assert.equal(readThemeCookie(`${THEME_COOKIE}=bogus`), null);
  assert.equal(readThemeCookie(""), null);
});

test("theme-color: 수동 모드면 그 색 하나, 시스템이면 기기 설정별 두 색", () => {
  assert.deepEqual(themeColorsFor("dark"), [{ color: WEB_APP_BACKGROUND.dark }]);
  assert.deepEqual(themeColorsFor("light"), [{ color: WEB_APP_BACKGROUND.light }]);
  assert.deepEqual(themeColorsFor(null), [
    { media: "(prefers-color-scheme: light)", color: WEB_APP_BACKGROUND.light },
    { media: "(prefers-color-scheme: dark)", color: WEB_APP_BACKGROUND.dark },
  ]);
});
