import { ExternalLink } from "lucide-react";

/** 플레이어가 실패했을 때 안내 문구 안에서 원본으로 가는 링크. 평소 원본 열기는 화면 머리가 맡는다. */
export function OriginalLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-secondary-foreground underline underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      원본 링크
      <ExternalLink className="size-3" strokeWidth={1.8} aria-hidden="true" />
    </a>
  );
}
