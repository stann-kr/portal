"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ImageViewer, type ViewerImage } from "@/components/image-viewer/ImageViewer";

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
    if (openFrom(event.target)) event.preventDefault();
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
