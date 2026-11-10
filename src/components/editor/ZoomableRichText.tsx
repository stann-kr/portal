"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ImageViewer, type ViewerImage } from "@/components/image-viewer/ImageViewer";
import { pushInApp } from "@/components/app-shell/NavigationProgress";

/**
 * 본문 링크를 누를 때 할 일. 포탈 안 주소는 앱 안 이동(문서를 새로 받지 않는다), 다른 사이트는 새 탭,
 * 같은 화면 안 위치(#)·보조 키·가운데 버튼은 브라우저에 맡긴다(null).
 */
export function richTextLinkAction(
  anchor: { getAttribute(name: string): string | null },
  origin: string,
  current: { pathname: string; search: string },
): { kind: "internal"; href: string } | { kind: "external"; href: string } | null {
  const raw = anchor.getAttribute("href");
  if (!raw || raw.startsWith("#") || /^(?:mailto|tel):/iu.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return { kind: "external", href: url.href };
  if (url.pathname === current.pathname && url.search === current.search && url.hash) return null;
  // 파일·API 주소(첨부 내려받기 등)는 문서로 연다.
  if (url.pathname.startsWith("/api/")) return null;
  return { kind: "internal", href: `${url.pathname}${url.search}${url.hash}` };
}

const ZOOM_WRAPPER_CLASS = "rich-text-zoom";

/** 링크 안 이미지는 링크로 남기고, 편집기(.ProseMirror) 이미지는 선택 동작에 맡긴다. */
export function isViewerImage(element: Element | null, root: Element): element is HTMLImageElement {
  return Boolean(
    element
      && element.tagName === "IMG"
      && root.contains(element)
      && !element.closest("a")
      && !element.closest(".ProseMirror"),
  );
}

function viewerImages(root: Element) {
  return [...root.querySelectorAll("img")].filter((img) => isViewerImage(img, root));
}

function enhance(img: HTMLImageElement) {
  const alt = img.getAttribute("alt")?.trim();
  img.setAttribute("tabindex", "0");
  img.setAttribute("role", "button");
  img.setAttribute("aria-label", alt ? `이미지 크게 보기: ${alt}` : "이미지 크게 보기");
  if (img.parentElement?.classList.contains(ZOOM_WRAPPER_CLASS)) return;
  // img에는 ::after를 붙일 수 없어 확대 표시를 둘 자리를 감싼다.
  const wrapper = img.ownerDocument.createElement("span");
  wrapper.className = ZOOM_WRAPPER_CLASS;
  img.replaceWith(wrapper);
  wrapper.append(img);
}

/**
 * RichTextContent의 읽기 화면 root. 저장된 HTML은 그대로 두고, 화면에 붙은 뒤 이미지에 확대 커서·키보드 초점을 더하고
 * 누르면 같은 글의 이미지들을 전체화면 뷰어로 연다.
 */
export function ZoomableRichText({ html, className }: { html: string; className: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<ViewerImage[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  // 같은 객체를 넘겨야 뷰어 상태가 바뀌어 다시 그려질 때 React가 innerHTML을 새로 쓰지 않는다(이미지·초점 보존).
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (root) viewerImages(root).forEach(enhance);
  }, [html]);

  const openFrom = useCallback((target: EventTarget | null) => {
    const root = rootRef.current;
    if (!root || !(target instanceof Element) || !isViewerImage(target, root)) return false;
    const list = viewerImages(root);
    const position = list.indexOf(target);
    if (position < 0) return false;
    setImages(list.map((img) => ({ src: img.getAttribute("src") ?? img.src, alt: img.getAttribute("alt") })));
    setReturnFocus(target);
    setIndex(position);
    return true;
  }, []);

  const onClick = (event: MouseEvent) => {
    if (openFrom(event.target)) {
      event.preventDefault();
      return;
    }
    // 본문 링크: 정화 단계가 target을 지워 모두 같은 탭 문서 이동이었다.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || !rootRef.current?.contains(anchor) || anchor.closest(".ProseMirror")) return;
    const action = richTextLinkAction(anchor, window.location.origin, window.location);
    if (!action) return;
    event.preventDefault();
    if (action.kind === "internal") pushInApp(action.href);
    else window.open(action.href, "_blank", "noopener,noreferrer");
  };

  // 버튼과 같게 Enter는 누를 때, Space는 뗄 때 연다. Space를 누를 때 열면 뗄 때 뷰어 닫기 버튼이 눌린다.
  const onKeyDown = (event: KeyboardEvent) => {
    const root = rootRef.current;
    if (event.key === "Enter" && openFrom(event.target)) event.preventDefault();
    if (event.key === " " && root && event.target instanceof Element && isViewerImage(event.target, root)) {
      event.preventDefault();
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " " && openFrom(event.target)) event.preventDefault();
  };

  return (
    <>
      {/* 위임 listener: 실제 상호작용 요소는 위에서 role=button·tabindex를 받은 img다. */}
      <div
        ref={rootRef}
        className={className}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        dangerouslySetInnerHTML={innerHtml}
      />
      <ImageViewer images={images} index={index} onIndexChange={setIndex} returnFocus={returnFocus} />
    </>
  );
}
