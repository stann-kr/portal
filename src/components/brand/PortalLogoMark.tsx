/**
 * @file src/components/brand/PortalLogoMark.tsx
 * @description 사이드바·로딩 셸의 Portal - Stann 로고 마크. 수치는 portal-mark.ts 하나에서 온다.
 * 타일은 글자색(foreground), 고리는 바탕색(background)이라 라이트에서는 잉크 타일·흰 고리,
 * 다크에서는 밝은 타일·어두운 고리로 자동으로 뒤집힌다.
 */
import { PORTAL_MARK, portalMarkTransform } from "./portal-mark";

export function PortalLogoMark({ size, className }: { size: number; className?: string }) {
  const v = PORTAL_MARK.viewBox;
  const small = size < PORTAL_MARK.smallBelow;
  const rings = small ? PORTAL_MARK.smallRings : PORTAL_MARK.rings;
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
      <rect width={v} height={v} rx={PORTAL_MARK.tileRadius} fill="var(--color-foreground)" />
      <g transform={portalMarkTransform(small)} fill="none" stroke="var(--color-background)">
        {rings.map(([r, w, cx, cy, o]) => (
          <ellipse key={r} cx={cx} cy={cy} rx={r} ry={r * PORTAL_MARK.aspect} strokeWidth={w} strokeOpacity={o} />
        ))}
      </g>
    </svg>
  );
}
