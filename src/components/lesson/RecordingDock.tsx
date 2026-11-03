"use client";

import { useEffect, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Headphones } from "lucide-react";
import { VideoPlayer, type MediaSeekRequest } from "@/components/player/VideoPlayer";
import { mediaSourceLabel } from "@/components/player/media-source";
import { formatLessonClock, findLessonRecording, type LessonRecording } from "./lesson-timestamps";
import { cn } from "@/lib/utils";

/**
 * 수업 녹음 재생 칸. 노트 본문의 첫 YouTube·SoundCloud 링크를 녹음으로 보고, 본문의 `[12:34]`를 누르면 그 시점을 재생한다.
 * 링크에 시작 위치(`t=`)가 있으면 믹스가 녹음의 그 지점부터라는 뜻으로 시점에 더한다.
 * 본문이 바뀔 때(공동 편집 포함) 링크를 다시 찾는다.
 */
export function RecordingDock({
  rootRef,
  className,
}: {
  rootRef: RefObject<HTMLElement | null>;
  /** 옆 칸이 있는 화면은 그만큼 비워 본문 가운데에 둔다. */
  className?: string;
}) {
  const [recording, setRecording] = useState<LessonRecording | null>(null);
  const [open, setOpen] = useState(false);
  const [seekRequest, setSeekRequest] = useState<MediaSeekRequest | undefined>(undefined);
  const [lastSeek, setLastSeek] = useState<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const scan = () => {
      frame = 0;
      const next = findLessonRecording(root);
      setRecording((previous) => (
        previous?.url === next?.url && previous?.offsetSeconds === next?.offsetSeconds ? previous : next
      ));
    };
    scan();
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(scan);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["href", "src"] });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (recording) root.setAttribute("data-lesson-recording", "");
    else root.removeAttribute("data-lesson-recording");
    if (!recording) return;
    const handleClick = (event: MouseEvent) => {
      const marker = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-lesson-seconds]") : null;
      if (!marker || !root.contains(marker)) return;
      const seconds = Number(marker.dataset.lessonSeconds);
      if (!Number.isFinite(seconds)) return;
      setOpen(true);
      setLastSeek(seconds);
      setSeekRequest({ seconds: recording.offsetSeconds + seconds });
    };
    root.addEventListener("click", handleClick);
    return () => {
      root.removeEventListener("click", handleClick);
      root.removeAttribute("data-lesson-recording");
    };
  }, [recording, rootRef]);

  if (!recording) return null;

  return (
    <div className={cn("pointer-events-none sticky bottom-3 z-30 flex justify-center px-5 md:bottom-5", className)}>
      <section
        aria-label="수업 녹음"
        className="pointer-events-auto flex w-full max-w-[720px] flex-col gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-h-9 items-center gap-2 rounded-sm px-2 text-left text-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Headphones className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            수업 녹음 · {mediaSourceLabel(recording.url)}
            <span className="text-muted-foreground">
              {lastSeek !== null ? ` · ${formatLessonClock(lastSeek)}부터` : " · 본문의 [시점]을 누르면 그 부분을 재생합니다"}
            </span>
          </span>
          {open
            ? <ChevronDown className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            : <ChevronUp className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />}
        </button>
        {/* 접어도 플레이어를 유지해 재생이 끊기지 않는다. */}
        <div hidden={!open} className="mx-auto w-full max-w-[calc(40dvh*16/9)]">
          <VideoPlayer url={recording.url} seekRequest={seekRequest} />
        </div>
      </section>
    </div>
  );
}
