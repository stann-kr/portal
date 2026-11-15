/**
 * @file src/components/editor/GuideQuotePicker.tsx
 * @description 노트 편집기 `/` 메뉴의 "가이드 인용" 패널(캔버스 GuideNoteQuote ④·⑤).
 * 넓은 화면은 가운데 760×520 패널(왼쪽 페이지 목록, 오른쪽 본문), 좁은 화면은 전체 시트로 먼저 페이지를 고르고
 * 다음 화면에서 본문을 고른다. 본문을 드래그해 고르면 "인용 넣기"가 켜진다. 목록은 서버가 노트의 학생(그룹은 멤버 모두)에게
 * 열린 페이지만 준다.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  getGuideQuotePickerPage,
  getGuideQuotePickerPages,
  type GuideQuotePickerTarget,
} from "@/lib/actions/guideNoteQuote";
import { buildGuideNoteQuoteHtml } from "@/lib/guide-note-quote";
import { collectGuideQuoteSelection, type CollectedGuideQuote } from "@/lib/guide-note-quote-selection";
import { cn } from "@/lib/utils";

type PageSummary = { id: string; title: string };
type PageBody = { id: string; title: string; contentHtml: string };
type Load<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: T };

export function GuideQuotePicker({
  target,
  onInsert,
  onClose,
}: {
  target: GuideQuotePickerTarget;
  onInsert: (html: string) => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<Load<PageSummary[]>>({ kind: "loading" });
  const [pageId, setPageId] = useState<string | null>(null);
  const [page, setPage] = useState<Load<PageBody> | null>(null);
  const [picked, setPicked] = useState<CollectedGuideQuote | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const targetKey = JSON.stringify(target);

  const loadPages = useCallback(() => {
    setPages({ kind: "loading" });
    getGuideQuotePickerPages(JSON.parse(targetKey) as GuideQuotePickerTarget)
      .then((result) => setPages(result.ok ? { kind: "ready", value: result.value } : { kind: "error", message: result.error }))
      .catch(() => setPages({ kind: "error", message: "가이드 목록을 불러오지 못했습니다." }));
  }, [targetKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 패널을 연 노트 기준 페이지 목록을 서버에서 읽는 동기화(불러오는 중 표시 포함).
    loadPages();
  }, [loadPages]);

  const openPage = useCallback(
    (id: string) => {
      setPageId(id);
      setPicked(null);
      setPage({ kind: "loading" });
      getGuideQuotePickerPage(JSON.parse(targetKey) as GuideQuotePickerTarget, id)
        .then((result) => setPage(result.ok ? { kind: "ready", value: result.value } : { kind: "error", message: result.error }))
        .catch(() => setPage({ kind: "error", message: "페이지를 불러오지 못했습니다." }));
    },
    [targetKey],
  );

  // 넓은 화면은 첫 페이지를 바로 보여 준다(좁은 화면은 목록부터).
  useEffect(() => {
    if (pages.kind !== "ready" || pageId || pages.value.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 화면 폭(matchMedia)은 mount 뒤에만 읽을 수 있다.
    if (window.matchMedia("(min-width: 48rem)").matches) openPage(pages.value[0].id);
  }, [openPage, pageId, pages]);

  // 본문 안에서 고른 구간을 읽는다.
  useEffect(() => {
    if (page?.kind !== "ready") return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const content = contentRef.current;
      const selection = window.getSelection();
      if (!content || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setPicked(null);
        return;
      }
      setPicked(collectGuideQuoteSelection(content, selection.getRangeAt(0)));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [page]);

  const insert = () => {
    if (page?.kind !== "ready" || !picked) return;
    const html = buildGuideNoteQuoteHtml({
      pageId: page.value.id,
      pageTitle: page.value.title,
      blockId: picked.blockId,
      blocks: picked.blocks,
      skippedImages: picked.skippedImages,
    });
    if (!html) return;
    window.getSelection()?.removeAllRanges();
    onInsert(html);
  };

  const status = picked
    ? `${picked.blocks.length}문단 고름${picked.skippedImages > 0 ? ` · 사진 ${picked.skippedImages}장은 빠짐` : ""}`
    : "본문을 드래그해 고르세요";
  const showBody = pageId !== null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        // 좁은 화면은 전체 시트, 넓은 화면은 가운데 760×520 패널. 손잡이·기본 여백은 쓰지 않는다.
        className="top-[env(safe-area-inset-top)] flex max-md:max-h-none max-md:rounded-none max-md:border-0 flex-col overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] pt-0 md:grid md:h-[520px] md:max-h-[calc(100dvh-2rem)] md:max-w-[760px] md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-[56px_minmax(0,1fr)_64px] md:p-0 [&>span[aria-hidden]]:hidden"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-muted pl-2 pr-14 md:col-span-2 md:pl-5">
          {showBody ? (
            <button
              type="button"
              onClick={() => {
                setPageId(null);
                setPage(null);
                setPicked(null);
              }}
              className="flex size-11 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <ChevronLeft className="size-5" strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">페이지 목록</span>
            </button>
          ) : (
            <span className="w-3 md:hidden" aria-hidden="true" />
          )}
          <DialogTitle className="truncate pr-0 text-md font-semibold md:text-[15px]">
            {showBody && page?.kind === "ready" ? <span className="md:hidden">{page.value.title}</span> : null}
            <span className={cn(showBody && page?.kind === "ready" && "max-md:hidden")}>가이드 인용</span>
          </DialogTitle>
          <DialogDescription className="sr-only">페이지를 고르고 본문을 드래그해 노트에 넣을 부분을 고릅니다.</DialogDescription>
        </div>

        <nav
          aria-label="가이드 페이지"
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:flex md:flex-col md:gap-0.5 md:border-r md:border-muted",
            showBody && "max-md:hidden",
          )}
        >
          {pages.kind === "loading" ? (
            <div className="flex flex-col gap-1 p-1" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="h-9 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : pages.kind === "error" ? (
            <div className="flex flex-col items-start gap-2 p-2">
              <p role="alert" className="text-ui text-destructive">{pages.message}</p>
              <Button type="button" variant="outline" size="sm" onClick={loadPages}>다시 시도</Button>
            </div>
          ) : pages.value.length === 0 ? (
            <p className="p-2 text-ui text-muted-foreground">이 노트의 학생에게 열린 가이드 페이지가 없습니다.</p>
          ) : (
            pages.value.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={item.id === pageId ? "page" : undefined}
                onClick={() => openPage(item.id)}
                className={cn(
                  "flex min-h-12 w-full items-center rounded-md px-3 text-left text-base text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 md:px-2.5 md:text-ui",
                  item.id === pageId && "bg-muted font-medium text-foreground",
                )}
              >
                <span className="truncate">{item.title}</span>
              </button>
            ))
          )}
        </nav>

        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 md:px-6", !showBody && "max-md:hidden")}>
          {page?.kind === "loading" ? (
            <div className="flex items-center gap-2 text-ui text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              불러오는 중…
            </div>
          ) : page?.kind === "error" ? (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-ui text-destructive">{page.message}</p>
              {pageId ? (
                <Button type="button" variant="outline" size="sm" onClick={() => openPage(pageId)}>다시 시도</Button>
              ) : null}
            </div>
          ) : page?.kind === "ready" ? (
            <div ref={contentRef} className="[&_a]:pointer-events-none">
              <RichTextContent html={page.value.contentHtml} className="text-sm leading-6 md:text-sm md:leading-6" />
            </div>
          ) : (
            <p className="max-md:hidden text-ui text-muted-foreground">왼쪽에서 페이지를 고르세요.</p>
          )}
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-3 border-t border-muted px-5 py-3 md:col-span-2 md:py-0 md:pl-5 md:pr-4",
            !showBody && "max-md:hidden",
          )}
        >
          <span aria-live="polite" className="text-xs text-muted-foreground">{status}</span>
          <Button type="button" onClick={insert} disabled={!picked} onMouseDown={(event) => event.preventDefault()} className="max-md:h-12 max-md:px-5">
            인용 넣기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
