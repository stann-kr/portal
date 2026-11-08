/**
 * 홈 화면 웹앱(manifest·theme-color meta)이 쓰는 색. CSS 변수를 읽을 수 없는 자리라 값을 직접 둔다.
 * globals.css의 --color-background(밝게 #ffffff·어둡게 #0f0f11)와 같은 값을 유지한다.
 */
export const WEB_APP_BACKGROUND = {
  light: "#ffffff",
  dark: "#0f0f11",
} as const;
