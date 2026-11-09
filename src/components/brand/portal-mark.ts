/**
 * @file src/components/brand/portal-mark.ts
 * @description Portal - Stann 로고 마크(평면 포탈 구멍)의 수치 원본. 사이드바·로그인 로고, 파비콘, 앱 아이콘이 모두 이 값으로 그려진다.
 * 48×48 좌표, 둥근 잉크 타일(rx 11) 위에 꽉 찬 타원 하나와 그 안의 구멍 하나. 구멍은 아래로 1.8 내려가
 * 위 테두리는 두껍고(5.27) 아래는 얇다(1.67). 좌우 두께 5.6. 구멍과 바깥 타원의 세로/가로 비는 0.62로 같다.
 * 바깥 타원 폭은 타일의 76%이고, 시각 중심(테두리 상자 중심 60% + 면 무게중심 40%)이 타일 가운데에 온다.
 * 캔버스 '브랜드 · Portal - Stann' 보드와 같은 값이다. 값을 바꾸면 src/app/icon.svg(테스트가 일치 확인)와
 * public/icons의 PNG·src/app/favicon.ico를 `portalMarkSvg` 결과로 다시 그려야 한다(브라우저 canvas로 래스터화:
 * any 192·512 둥근 타일, maskable 512 꽉 찬 사각 scale 0.8, apple-touch 180 꽉 찬 사각, favicon 16·32·48).
 */

export const PORTAL_MARK = {
  viewBox: 48,
  tileRadius: 11,
  /** 바깥 타원(면) */
  outer: { cx: 24, cy: 24.66, rx: 18.24, ry: 11.31 },
  /** 구멍(타일 색으로 뚫음) */
  hole: { cx: 24, cy: 26.46, rx: 12.64, ry: 7.84 },
} as const;

export const PORTAL_BRAND_COLORS = {
  /** 라이트 화면·파비콘·앱 아이콘: 잉크 타일 + 흰 면 */
  ink: "#18181B",
  paper: "#FFFFFF",
  /** 다크 화면: 밝은 타일 + 어두운 면 */
  inkOnDark: "#ECECEE",
  paperOnDark: "#151517",
} as const;

export const PORTAL_SERVICE_NAME = "Portal - Stann";
export const PORTAL_SHORT_NAME = "Portal";

const fmt = (value: number) => String(Math.round(value * 100) / 100);

/** 마크 면 SVG 조각(타일 제외). fg는 면 색, bg는 구멍(타일) 색. */
export function portalMarkShapesSvg(fg: string, bg: string): string {
  const { outer, hole } = PORTAL_MARK;
  return `<ellipse cx="${fmt(outer.cx)}" cy="${fmt(outer.cy)}" rx="${fmt(outer.rx)}" ry="${fmt(outer.ry)}" fill="${fg}"/>`
    + `<ellipse cx="${fmt(hole.cx)}" cy="${fmt(hole.cy)}" rx="${fmt(hole.rx)}" ry="${fmt(hole.ry)}" fill="${bg}"/>`;
}

/**
 * 완성된 SVG 문서. `tile`: rounded(둥근 타일, 파비콘·any 아이콘) | square(꽉 찬 사각, iOS·maskable).
 * `scale`은 마크를 가운데 기준으로 줄인다(maskable 안전 영역 0.8).
 */
export function portalMarkSvg({
  tile = "rounded",
  scale = 1,
  bg = PORTAL_BRAND_COLORS.ink,
  fg = PORTAL_BRAND_COLORS.paper,
}: { tile?: "rounded" | "square"; scale?: number; bg?: string; fg?: string } = {}): string {
  const v = PORTAL_MARK.viewBox;
  const c = v / 2;
  const rx = tile === "rounded" ? PORTAL_MARK.tileRadius : 0;
  const shapes = portalMarkShapesSvg(fg, bg);
  const mark = scale === 1 ? shapes : `<g transform="translate(${c} ${c}) scale(${scale}) translate(${-c} ${-c})">${shapes}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}"><rect width="${v}" height="${v}" rx="${rx}" fill="${bg}"/>${mark}</svg>`;
}
