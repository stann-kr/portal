"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { reorderGuidePages } from "@/lib/actions/guide";
import { guidePagePath } from "@/lib/guide-content";
import { cn } from "@/lib/utils";
import { GuideNewPageButton } from "./GuideNewPageButton";

export type GuideNavPage = { id: string; title: string };

const ORDER_BUTTON =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";

/**
 * 가이드 페이지 목록. 넓은 화면은 왼쪽 열, 좁은 화면은 본문 위 가로 줄이다.
 * 관리자는 넓은 화면 목록에서 위·아래로 순서를 바꾸고 새 페이지를 만든다. 순서는 서버에 한 번에 저장한다.
 */
export function GuidePageNav({
  pages,
  currentId,
  canManage,
}: {
  pages: readonly GuideNavPage[];
  currentId: string | null;
  canManage: boolean;
}) {
  const router = useProgressRouter();
  const [order, setOrder] = useState(pages);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    // 서버 목록이 새로 오면(다른 화면의 변경 포함) 그 순서를 따른다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버가 다시 보낸 목록으로 낙관적 순서를 맞춘다.
    setOrder(pages);
  }, [pages]);

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= order.length) return;
    const previous = order;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
    setError(null);
    startTransition(async () => {
      try {
        const result = await reorderGuidePages(next.map((page) => page.id));
        if (!result.ok) {
          setOrder(previous);
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setOrder(previous);
        setError("순서를 저장하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <>
      <nav aria-label="가이드 페이지" className="-mx-5 overflow-x-auto px-5 md:hidden">
        <ul className="flex gap-1.5 pb-1">
          {order.map((page) => (
            <li key={page.id} className="shrink-0">
              <Link
                href={guidePagePath(page.id)}
                aria-current={page.id === currentId ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center rounded-touch border px-3.5 text-body",
                  page.id === currentId
                    ? "border-foreground bg-foreground text-primary-foreground"
                    : "border-border text-secondary-foreground",
                )}
              >
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <aside className="hidden w-[220px] shrink-0 md:block">
        <nav aria-label="가이드 페이지" className="sticky top-6 flex flex-col gap-3">
          <p className="px-2 text-xs font-medium text-muted-foreground">가이드</p>
          <ol className="flex flex-col gap-0.5" aria-busy={isPending}>
            {order.map((page, index) => (
              <li key={page.id} className="group flex items-center gap-0.5">
                <Link
                  href={guidePagePath(page.id)}
                  aria-current={page.id === currentId ? "page" : undefined}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-ui transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    page.id === currentId
                      ? "bg-selected font-medium text-foreground"
                      : "text-secondary-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {page.title}
                </Link>
                {canManage ? (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      className={ORDER_BUTTON}
                      aria-label={`위로 옮기기: ${page.title}`}
                      disabled={isPending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={ORDER_BUTTON}
                      aria-label={`아래로 옮기기: ${page.title}`}
                      disabled={isPending || index === order.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {error ? (
            <p role="alert" className="px-2 text-ui text-destructive">{error}</p>
          ) : null}
          {canManage ? <GuideNewPageButton /> : null}
        </nav>
      </aside>
    </>
  );
}
