/**
 * @file src/components/brand/PortalLogoMark.tsx
 * @description 사이드바·로딩 셸·로그인의 Portal - Stann 로고 마크(평면 포탈 구멍). 수치는 portal-mark.ts 하나에서 온다.
 * 타일과 구멍은 글자색(foreground), 면은 바탕색(background)이라 라이트에서는 잉크 타일·흰 면,
 * 다크에서는 밝은 타일·어두운 면으로 자동으로 뒤집힌다.
 */
import { PORTAL_MARK } from "./portal-mark";

export function PortalLogoMark({ size, className }: { size: number; className?: string }) {
  const { viewBox: v, tileRadius, outer, hole } = PORTAL_MARK;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${v} ${v}`}
      aria-hidden="true"
      focusable="false"
      className={className}
      data-portal-logo-mark=""
    >
      <rect width={v} height={v} rx={tileRadius} fill="var(--color-foreground)" />
      <ellipse cx={outer.cx} cy={outer.cy} rx={outer.rx} ry={outer.ry} fill="var(--color-background)" />
      <ellipse cx={hole.cx} cy={hole.cy} rx={hole.rx} ry={hole.ry} fill="var(--color-foreground)" />
    </svg>
  );
}
