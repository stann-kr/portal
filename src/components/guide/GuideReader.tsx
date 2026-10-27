"use client";

/**
 * 가이드 읽기 화면 본문. 질문이 걸린 블록 옆에 표시를 두고, 학생이 본문 구간을 고르면 "이 부분 질문"으로
 * 그 위치에 Q&A를 남긴다. 어느 질문을 보여 줄지는 서버가 이미 골랐다(학생 본인·관리자 전체).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleHelp, MessageCircleQuestion, X } from "lucide-react";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { QnaStatusLabel } from "@/components/qna/qna-display";
import { QnaSlideForm, type QnaGuideAnchorInput } from "@/components/qna/QnaSlideForm";
import { SlidePanel } from "@/components/student-portal/SlidePanel";
import { Button } from "@/components/ui/button";
import type { QnaStatus } from "@/db/schema";
import { guidePagePath, normalizeGuideQuote } from "@/lib/guide-content";
import { cn } from "@/lib/utils";

export type GuideReaderQuestion = {
  threadId: string;
  threadTitle: string;
  status: QnaStatus;
  studentName: string | null;
  blockId: string | null;
  quote: string;
};

type SelectionAnchor = { blockId: string; quote: string; top: number; left: number };

const BLOCK_SELECTOR = "[data-block-id]";

function findBlock(content: HTMLElement, node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  const block = element?.closest<HTMLElement>(BLOCK_SELECTOR) ?? null;
  return block && content.contains(block) ? block : null;
}

function queryBlock(content: HTMLElement, blockId: string): HTMLElement | null {
  return content.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
}

export function GuideReader({
  page,
  blockIds,
  questions,
  canAsk,
  showStudentNames,
  actorId,
}: {
  page: { id: string; title: string; contentHtml: string };
  /** 지금 본문에 있는 블록 식별자(서버가 본문에서 읽었다). 없는 식별자의 질문은 "위치가 바뀐 질문"이다. */
  blockIds: readonly string[];
  questions: readonly GuideReaderQuestion[];
  canAsk: boolean;
  showStudentNames: boolean;
  actorId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [markerTops, setMarkerTops] = useState<Record<string, number>>({});
  const [openMarker, setOpenMarker] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [panelAnchor, setPanelAnchor] = useState<QnaGuideAnchorInput | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const returnTo = guidePagePath(page.id);

  const { byBlock, moved, pageLevel } = useMemo(() => {
    const present = new Set(blockIds);
    const grouped = new Map<string, GuideReaderQuestion[]>();
    const movedQuestions: GuideReaderQuestion[] = [];
    const pageQuestions: GuideReaderQuestion[] = [];
    for (const question of questions) {
      if (!question.blockId) pageQuestions.push(question);
      else if (!present.has(question.blockId)) movedQuestions.push(question);
      else grouped.set(question.blockId, [...(grouped.get(question.blockId) ?? []), question]);
    }
    return { byBlock: grouped, moved: movedQuestions, pageLevel: pageQuestions };
  }, [blockIds, questions]);

  // 질문이 걸린 블록에 옅은 면을 칠하고, 블록 옆 표시의 세로 위치를 잰다.
  const measure = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const containerTop = container.getBoundingClientRect().top;
    const tops: Record<string, number> = {};
    for (const element of content.querySelectorAll<HTMLElement>("[data-guide-has-question]")) {
      element.removeAttribute("data-guide-has-question");
    }
    for (const blockId of byBlock.keys()) {
      const block = queryBlock(content, blockId);
      if (!block) continue;
      block.setAttribute("data-guide-has-question", "");
      tops[blockId] = Math.max(0, block.getBoundingClientRect().top - containerTop);
    }
    setMarkerTops(tops);
  }, [byBlock]);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, page.contentHtml]);

  // 주소의 #블록식별자(Q&A에서 돌아온 경우)로 그 블록을 보이고 잠시 표시한다.
  useEffect(() => {
    const focusHash = () => {
      const content = contentRef.current;
      const raw = window.location.hash.slice(1);
      if (!content || !raw) return;
      let blockId = raw;
      try {
        blockId = decodeURIComponent(raw);
      } catch {
        return;
      }
      const block = queryBlock(content, blockId);
      if (!block) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      block.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      block.setAttribute("data-guide-focus", "");
      window.setTimeout(() => block.removeAttribute("data-guide-focus"), 2400);
    };
    focusHash();
    window.addEventListener("hashchange", focusHash);
    return () => window.removeEventListener("hashchange", focusHash);
  }, [page.contentHtml]);

  // 학생이 본문 안에서 고른 구간을 질문 위치로 잡는다.
  useEffect(() => {
    if (!canAsk) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const container = containerRef.current;
      const content = contentRef.current;
      const current = window.getSelection();
      if (!container || !content || !current || current.rangeCount === 0 || current.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = current.getRangeAt(0);
      if (!content.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const block = findBlock(content, range.commonAncestorContainer) ?? findBlock(content, range.startContainer);
      const quote = normalizeGuideQuote(current.toString());
      const blockId = block?.getAttribute("data-block-id");
      if (!block || !blockId || !quote) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      setSelection({
        blockId,
        quote,
        top: Math.max(0, rect.bottom - box.top + 6),
        left: Math.min(Math.max(0, rect.left - box.left), Math.max(0, box.width - 140)),
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [canAsk]);

  useEffect(() => {
    if (!openMarker) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMarker(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [openMarker]);

  const openQuestion = (anchor: QnaGuideAnchorInput) => {
    setNotice(null);
    setPanelAnchor(anchor);
    setSelection(null);
  };

  const questionHref = (threadId: string) => `/dashboard/qna/${threadId}?returnTo=${encodeURIComponent(returnTo)}`;
  const goToBlock = (blockId: string) => {
    const hash = `#${encodeURIComponent(blockId)}`;
    if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else window.location.hash = hash;
  };

  return (
    <div className="flex flex-col gap-10">
      <div ref={containerRef} className="relative md:pr-12">
        <div
          ref={contentRef}
          className="[&_[data-guide-focus]]:outline-2 [&_[data-guide-focus]]:outline-offset-4 [&_[data-guide-focus]]:outline-ring [&_[data-guide-has-question]]:rounded-sm [&_[data-guide-has-question]]:bg-accent"
        >
          <RichTextContent html={page.contentHtml} />
        </div>

        {[...byBlock.entries()].map(([blockId, blockQuestions]) =>
          markerTops[blockId] === undefined ? null : (
            <div key={blockId} className="absolute right-0 z-10" style={{ top: markerTops[blockId] }}>
              <button
                type="button"
                aria-expanded={openMarker === blockId}
                aria-label={`이 부분의 질문 ${blockQuestions.length}개 보기`}
                onClick={() => setOpenMarker((current) => (current === blockId ? null : blockId))}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-2 text-xs text-accent-foreground shadow-segment transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageCircleQuestion className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                {blockQuestions.length}
              </button>
              {openMarker === blockId ? (
                <div className="absolute right-0 top-9 w-72 rounded-lg border border-border bg-background p-2 shadow-floating">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <p className="text-xs font-medium text-muted-foreground">이 부분의 질문</p>
                    <button
                      type="button"
                      aria-label="닫기"
                      onClick={() => setOpenMarker(null)}
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                    </button>
                  </div>
                  <ul className="flex flex-col">
                    {blockQuestions.map((question) => (
                      <li key={question.threadId}>
                        <Link
                          href={questionHref(question.threadId)}
                          className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate text-ui font-medium text-foreground">{question.threadTitle}</span>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <QnaStatusLabel status={question.status} className="text-xs" />
                            {showStudentNames && question.studentName ? <span>· {question.studentName}</span> : null}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ),
        )}

        {canAsk && selection ? (
          <div className="absolute z-20" style={{ top: selection.top, left: selection.left }}>
            <Button
              type="button"
              size="sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                openQuestion({ pageId: page.id, pageTitle: page.title, blockId: selection.blockId, quote: selection.quote })
              }
              className="shadow-floating"
            >
              <CircleHelp className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              이 부분 질문
            </Button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <p role="status" className="rounded-touch bg-success-muted px-3.5 py-2.5 text-ui text-success">{notice}</p>
      ) : null}

      <section aria-labelledby="guide-questions-heading" className="flex flex-col gap-3 border-t border-muted pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="guide-questions-heading" className="text-base font-semibold text-foreground">
            {showStudentNames ? "학생 질문" : "내 질문"}
          </h2>
          {canAsk ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => openQuestion({ pageId: page.id, pageTitle: page.title, blockId: null, quote: page.title })}
            >
              <CircleHelp className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              이 페이지에 질문
            </Button>
          ) : null}
        </div>
        {canAsk ? (
          <p className="text-ui text-muted-foreground">본문에서 궁금한 부분을 드래그해 고르면 그 위치에 질문을 남길 수 있습니다. 질문은 나와 관리자만 봅니다.</p>
        ) : null}
        {questions.length === 0 ? (
          <p className="text-ui text-secondary-foreground">아직 이 페이지에 남긴 질문이 없습니다.</p>
        ) : (
          <QuestionList
            questions={[...[...byBlock.values()].flat(), ...pageLevel]}
            showStudentNames={showStudentNames}
            questionHref={questionHref}
            onGoToBlock={(blockId) => goToBlock(blockId)}
          />
        )}
      </section>

      {moved.length > 0 ? (
        <section aria-labelledby="guide-moved-heading" className="flex flex-col gap-3">
          <h2 id="guide-moved-heading" className="text-base font-semibold text-foreground">위치가 바뀐 질문</h2>
          <p className="text-ui text-muted-foreground">가이드가 고쳐져 처음 질문한 문단이 지금 본문에 없습니다. 질문할 때 고른 글을 함께 보여 줍니다.</p>
          <QuestionList questions={moved} showStudentNames={showStudentNames} questionHref={questionHref} />
        </section>
      ) : null}

      {canAsk ? (
        <SlidePanel
          open={panelAnchor !== null}
          onOpenChange={(open) => {
            if (!open) setPanelAnchor(null);
          }}
          title="가이드 질문"
          size="xl"
          dismissible={!formBusy}
        >
          {panelAnchor ? (
            <QnaSlideForm
              actorId={actorId}
              spaceLabel="내 스페이스"
              returnTo={returnTo}
              guideAnchor={panelAnchor}
              navigateOnSuccess={false}
              onSuccess={() => {
                setPanelAnchor(null);
                window.getSelection()?.removeAllRanges();
                setNotice("질문을 남겼습니다. 답변이 오면 Q&A에서 확인할 수 있습니다.");
              }}
              onClose={() => setPanelAnchor(null)}
              onBusyChange={setFormBusy}
            />
          ) : null}
        </SlidePanel>
      ) : null}
    </div>
  );
}

function QuestionList({
  questions,
  showStudentNames,
  questionHref,
  onGoToBlock,
}: {
  questions: readonly GuideReaderQuestion[];
  showStudentNames: boolean;
  questionHref: (threadId: string) => string;
  onGoToBlock?: (blockId: string) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-muted rounded-lg border border-muted">
      {questions.map((question) => (
        <li key={question.threadId} className="flex flex-col gap-1.5 px-4 py-3 md:flex-row md:items-start md:justify-between md:gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={questionHref(question.threadId)}
              className="truncate rounded-sm text-body font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {question.threadTitle}
            </Link>
            <p className={cn("line-clamp-2 text-ui text-secondary-foreground")}>“{question.quote}”</p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <QnaStatusLabel status={question.status} className="text-xs" />
              {showStudentNames && question.studentName ? <span>· {question.studentName}</span> : null}
            </p>
          </div>
          {onGoToBlock && question.blockId ? (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onGoToBlock(question.blockId!)}>
              위치 보기
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
