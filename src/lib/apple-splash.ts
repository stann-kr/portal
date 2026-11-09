/**
 * @file src/lib/apple-splash.ts
 * @description 홈 화면 앱(iPhone) 시작 화면 이미지 목록. 서버 응답을 기다리는 동안 iOS가 기기에 저장된 이 이미지를 바로 보인다
 * (캔버스 '홈 화면 앱 · 시작 화면' A안). 이미지는 `node scripts/generate-splash.mjs`가 public/splash/에 만든다(같은 크기 목록).
 * 기기 설정(라이트·다크)을 따르며, media가 맞는 크기가 없으면 iOS는 시작 화면 없이 연다.
 */
import type { Metadata } from "next";

/** [CSS 폭, CSS 높이, 픽셀 비율] 세로 화면. */
export const APPLE_SPLASH_DEVICES: ReadonlyArray<readonly [number, number, number]> = [
  [440, 956, 3], // 16·17 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16 Pro·17·17 Pro
  [430, 932, 3], // 14 Pro Max·15 Plus·15 Pro Max·16 Plus
  [393, 852, 3], // 14 Pro·15·15 Pro·16
  [428, 926, 3], // 12·13 Pro Max·14 Plus
  [390, 844, 3], // 12·13·14·12·13 Pro
  [375, 812, 3], // X·XS·11 Pro·12·13 mini
  [414, 896, 3], // XS Max·11 Pro Max
  [414, 896, 2], // XR·11
  [414, 736, 3], // 6·7·8 Plus
  [375, 667, 2], // SE 2·3세대·6·7·8
];

export function appleSplashPath(width: number, height: number, ratio: number, theme: "light" | "dark"): string {
  return `/splash/apple-splash-${width * ratio}x${height * ratio}-${theme}.png`;
}

export function appleStartupImages(): NonNullable<Exclude<Metadata["appleWebApp"], boolean | null | undefined>["startupImage"]> {
  return APPLE_SPLASH_DEVICES.flatMap(([width, height, ratio]) => {
    const device = `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`;
    return (["light", "dark"] as const).map((theme) => ({
      url: appleSplashPath(width, height, ratio, theme),
      media: `${device} and (prefers-color-scheme: ${theme})`,
    }));
  });
}
