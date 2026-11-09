/**
 * @file src/components/ui/CopyLinkButton.tsx
 * @description 지금 보고 있는 화면(또는 준 경로)의 링크 복사 버튼(UsabilityBundle ⑩).
 * 터치 기기에서 공유 창(navigator.share)을 쓸 수 있으면 같은 자리에서 공유 창을 열고,
 * 아니면 클립보드에 절대 주소를 복사한 뒤 "링크를 복사했습니다"를 2초 보인다.
 * 주소는 로그인한 사람만 열 수 있는 포탈 경로다.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ShareOrCopyResult = "shared" | "copied" | "cancelled" | "failed";

type ShareCapableNavigator = {
  share?: (data: { url: string; title?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/**
 * 공유 창 또는 클립보드로 링크를 넘긴다. preferShare는 터치(거친 포인터) 기기일 때 true로 준다.
 * 공유 창을 사용자가 닫으면(AbortError) 복사하지 않고, 공유가 다른 이유로 실패하면 클립보드로 넘어간다.
 */
export async function shareOrCopyLink(
  url: string,
  options: { navigator: ShareCapableNavigator; preferShare: boolean; title?: string },
): Promise<ShareOrCopyResult> {
  const { navigator: nav, preferShare, title } = options;
  if (preferShare && typeof nav.share === "function") {
    try {
      await nav.share(title ? { url, title } : { url });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  if (!nav.clipboard || typeof nav.clipboard.writeText !== "function") return "failed";
  try {
    await nav.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/** 같은 출처 경로를 지금 주소의 origin과 합쳐 절대 주소를 만든다. */
export function absolutePortalUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

const STATUS_VISIBLE_MS = 2000;

export function CopyLinkButton({
  path,
  title,
  className,
  label = "링크 복사",
}: {
  /** 복사할 포탈 경로(`/dashboard/qna/…`). 없으면 지금 화면 주소. */
  path?: string;
  /** 공유 창에 함께 넘길 제목. */
  title?: string;
  className?: string;
  label?: string;
}) {
  const [status, setStatus] = useState<"copied" | "failed" | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const showStatus = (next: "copied" | "failed") => {
    setStatus(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setStatus(null), STATUS_VISIBLE_MS);
  };

  const handleClick = async () => {
    const target = path ?? `${window.location.pathname}${window.location.search}`;
    const url = absolutePortalUrl(window.location.origin, target);
    const preferShare = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const result = await shareOrCopyLink(url, { navigator: window.navigator, preferShare, title });
    if (result === "copied" || result === "failed") showStatus(result);
  };

  return (
    <span className={cn("relative inline-flex", className)}>
      <Button type="button" variant="ghost" onClick={handleClick}>
        <Link2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
        {label}
      </Button>
      {/* 읽기 프로그램이 바뀐 문구를 읽도록 live 영역은 늘 두고 내용만 바꾼다. */}
      <span
        role="status"
        className={cn(
          "pointer-events-none absolute right-0 top-full z-10 mt-1 whitespace-nowrap empty:hidden",
          status && "inline-flex items-center gap-1.5 rounded-md bg-sidebar px-2.5 py-1.5 text-xs text-foreground",
          status === "failed" && "text-destructive",
        )}
      >
        {status === "copied" ? (
          <>
            <Check className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
            링크를 복사했습니다
          </>
        ) : status === "failed" ? "링크를 복사하지 못했습니다. 주소창의 주소를 복사해 주세요." : null}
      </span>
    </span>
  );
}
