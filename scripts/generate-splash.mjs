/**
 * 홈 화면 앱(iPhone) 시작 화면 이미지를 만든다. 캔버스 '홈 화면 앱 · 시작 화면' A안: 앱 바탕색 위 가운데 로고 마크(폭 20%).
 * 라이트(#FFFFFF, 잉크 타일)·다크(#0F0F11, 밝은 타일) 두 벌. 크기 목록은 src/lib/apple-splash.ts와 같다.
 * 실행: node scripts/generate-splash.mjs (sharp 사용, 결과는 public/splash/).
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// [CSS 폭, CSS 높이, 픽셀 비율] — src/lib/apple-splash.ts APPLE_SPLASH_DEVICES와 같은 순서·값.
const DEVICES = [
  [440, 956, 3], [420, 912, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3],
  [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2],
];
const THEMES = {
  light: { bg: "#ffffff", tile: "#18181B", face: "#ffffff" },
  dark: { bg: "#0f0f11", tile: "#ECECEE", face: "#0f0f11" },
};
// src/components/brand/portal-mark.ts PORTAL_MARK와 같은 수치(48×48).
const MARK = { tileRadius: 11, outer: [24, 24.66, 18.24, 11.31], hole: [24, 26.46, 12.64, 7.84] };

function svg(width, height, theme) {
  const size = Math.round(width * 0.2);
  const x = Math.round((width - size) / 2);
  const y = Math.round((height - size) / 2);
  const s = size / 48;
  const [ocx, ocy, orx, ory] = MARK.outer;
  const [hcx, hcy, hrx, hry] = MARK.hole;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="${theme.bg}"/>`
    + `<g transform="translate(${x} ${y}) scale(${s})">`
    + `<rect width="48" height="48" rx="${MARK.tileRadius}" fill="${theme.tile}"/>`
    + `<ellipse cx="${ocx}" cy="${ocy}" rx="${orx}" ry="${ory}" fill="${theme.face}"/>`
    + `<ellipse cx="${hcx}" cy="${hcy}" rx="${hrx}" ry="${hry}" fill="${theme.tile}"/>`
    + `</g></svg>`;
}

const out = join(process.cwd(), "public", "splash");
await mkdir(out, { recursive: true });
for (const [w, h, r] of DEVICES) {
  const width = w * r;
  const height = h * r;
  for (const [name, theme] of Object.entries(THEMES)) {
    const file = join(out, `apple-splash-${width}x${height}-${name}.png`);
    await sharp(Buffer.from(svg(width, height, theme))).png({ compressionLevel: 9, palette: true }).toFile(file);
  }
}
console.log(`splash: ${DEVICES.length * 2} files in public/splash`);
