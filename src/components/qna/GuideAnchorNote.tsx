import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { guidePagePath } from "@/lib/guide-content";

export type QnaGuideAnchorView = {
  guidePageId: string | null;
  pageTitle: string;
  blockId: string | null;
  quote: string;
};

/** Q&A가 가이드의 어느 구간에서 시작됐는지 보인다. 페이지가 지워졌으면 제목·인용만 남긴다. */
export function GuideAnchorNote({ anchor }: { anchor: QnaGuideAnchorView }) {
  const label = (
    <>
      가이드: {anchor.pageTitle} — <span className="text-foreground">“{anchor.quote}”</span>
    </>
  );
  return (
    <p className="flex items-start gap-2 rounded-touch bg-sidebar px-3 py-2.5 text-ui text-secondary-foreground">
      <BookOpenText className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
      {anchor.guidePageId ? (
        <Link
          href={guidePagePath(anchor.guidePageId, anchor.blockId)}
          className="min-w-0 break-words rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </Link>
      ) : (
        <span className="min-w-0 break-words">
          {label} <span className="text-muted-foreground">(가이드 페이지가 삭제되었습니다)</span>
        </span>
      )}
    </p>
  );
}
