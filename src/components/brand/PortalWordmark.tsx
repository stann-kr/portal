/**
 * @file src/components/brand/PortalWordmark.tsx
 * @description 서비스 이름 'Portal - Stann' 글자. 'Portal'은 굵게, '- Stann'은 연한 보통 굵기(캔버스 브랜드 보드).
 */
import { cn } from "@/lib/utils";

export function PortalWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("truncate font-semibold tracking-title", className)}>
      Portal<span className="font-normal text-muted-foreground"> - Stann</span>
    </span>
  );
}
