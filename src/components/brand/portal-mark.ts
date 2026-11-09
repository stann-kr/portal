/**
 * @file src/components/brand/portal-mark.ts
 * @description Portal - Stann 로고 마크(B3 · 블랙홀)의 수치 원본. 사이드바 로고·파비콘·앱 아이콘이 모두 이 값으로 그려진다.
 * 48×48 좌표, 둥근 타일(rx 11) 위에 -24° 기울인 타원 고리 다섯. 가장 큰 고리(입구) 아래로 안쪽 고리가 깔때기처럼
 * 내려가며 작아진다. 반지름은 같은 비율(×0.626)로 줄고, 선 굵기는 1.2 + 2.6 × (반지름/17)^0.6,
 * 고리 중심의 낙차는 중력 우물처럼 처음엔 완만하고 목 근처에서 가파르다(낙차 = 18.5 × 진행도^1.5,
 * 진행도 = (17 − 반지름) / 14.4). 중간 고리는 옅어지고 가장 깊은 고리는 다시 밝다(터널 끝의 빛, 아래쪽 무게). 24px 미만(파비콘 16px)은 고리 둘로 줄인 작은 크기용을 쓴다.
 * 캔버스 '브랜드 · Portal - Stann' 보드와 같은 값이다. 값을 바꾸면 src/app/icon.svg(테스트가 일치 확인)와
 * public/icons의 PNG·src/app/favicon.ico를 `portalMarkSvg` 결과로 다시 그려야 한다(브라우저 canvas로 래스터화:
 * any 192·512 둥근 타일, maskable 512 꽉 찬 사각 scale 0.8, apple-touch 180 꽉 찬 사각, favicon 16(small)·32·48).
 */

export const PORTAL_MARK = {
  viewBox: 48,
  tileRadius: 11,
  rotation: -24,
  /** 타원 세로/가로 비 */
  aspect: 0.55,
  /** [반지름, 선 굵기, 중심 x, 중심 y, 진하기] — 회전 전 48×48 좌표. 뒤로 갈수록 깊은 고리. */
  rings: [
    [17, 3.8, 24, 17.5, 1],
    [10.63, 3.16, 23.25, 22.94, 0.8],
    [6.65, 2.68, 22.78, 28.78, 0.64],
    [4.16, 2.32, 22.48, 33.08, 0.5],
    [2.6, 1.5, 22.3, 36, 0.9],
  ],
  smallRings: [
    [17, 4.6, 24, 17.5, 1],
    [8.5, 3, 23, 25.89, 0.85],
  ],
  /**
   * 회전한 마크를 타일에 맞추는 값(48 기준): `center`(시각 중심)를 (24, 24)로 옮기고 `scale`배 한다.
   * 시각 중심 = 테두리 상자 중심 60% + 선 무게중심 40%. 크기는 마크의 긴 변이 타일의 76%가 되게 했다.
   */
  fit: { scale: 1.021, center: [22.25, 22.97] },
  smallFit: { scale: 0.999, center: [21.71, 19.75] },
  /** 24px 미만이면 smallRings */
  smallBelow: 24,
} as const;

export const PORTAL_BRAND_COLORS = {
  /** 라이트 화면·파비콘·앱 아이콘: 잉크 타일 + 흰 고리 */
  ink: "#18181B",
  paper: "#FFFFFF",
  /** 다크 화면 사이드바: 밝은 타일 + 어두운 고리 */
  inkOnDark: "#ECECEE",
  paperOnDark: "#151517",
} as const;

export const PORTAL_SERVICE_NAME = "Portal - Stann";
export const PORTAL_SHORT_NAME = "Portal";

type Ring = readonly [number, number, number, number, number];

const fmt = (value: number) => String(Math.round(value * 100) / 100);

/** 고리 묶음을 타일 가운데에 놓는 SVG transform. */
export function portalMarkTransform(small = false): string {
  const c = PORTAL_MARK.viewBox / 2;
  const { scale, center } = small ? PORTAL_MARK.smallFit : PORTAL_MARK.fit;
  return `translate(${c} ${c}) scale(${scale}) translate(${-center[0]} ${-center[1]}) rotate(${PORTAL_MARK.rotation} ${c} ${c})`;
}

/** 고리 SVG 조각(타일 제외). fg는 고리 색. */
export function portalRingsSvg(fg: string, small = false): string {
  const rings: readonly Ring[] = small ? PORTAL_MARK.smallRings : PORTAL_MARK.rings;
  const body = rings
    .map(([r, w, cx, cy, o]) =>
      `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(r)}" ry="${fmt(r * PORTAL_MARK.aspect)}" fill="none" stroke="${fg}" stroke-width="${fmt(w)}"${o < 1 ? ` stroke-opacity="${o}"` : ""}/>`)
    .join("");
  return `<g transform="${portalMarkTransform(small)}">${body}</g>`;
}

/**
 * 완성된 SVG 문서. `tile`: rounded(둥근 타일, 파비콘·any 아이콘) | square(꽉 찬 사각, iOS·maskable).
 * `scale`은 마크를 가운데 기준으로 줄인다(maskable 안전 영역 0.8).
 */
export function portalMarkSvg({
  tile = "rounded",
  small = false,
  scale = 1,
  bg = PORTAL_BRAND_COLORS.ink,
  fg = PORTAL_BRAND_COLORS.paper,
}: { tile?: "rounded" | "square"; small?: boolean; scale?: number; bg?: string; fg?: string } = {}): string {
  const v = PORTAL_MARK.viewBox;
  const c = v / 2;
  const rx = tile === "rounded" ? PORTAL_MARK.tileRadius : 0;
  const rings = portalRingsSvg(fg, small);
  const mark = scale === 1 ? rings : `<g transform="translate(${c} ${c}) scale(${scale}) translate(${-c} ${-c})">${rings}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}"><rect width="${v}" height="${v}" rx="${rx}" fill="${bg}"/>${mark}</svg>`;
}
