/**
 * @file src/components/qna/ReplyAttachmentImage.tsx
 * @description Q&A 이미지 첨부의 160×120 미리보기(캔버스 ImageViewer "Q&A 첨부 이미지").
 * 누르면 본문 이미지와 같은 전체화면 뷰어(ImageViewer)를 열고, 닫으면 미리보기 버튼으로 초점을 돌린다.
 */
"use client";

import { useState } from "react";
import { ImageViewer } from "@/components/image-viewer/ImageViewer";

export function ReplyAttachmentImage({ src, name }: { src: string; name: string }) {
  // 저장 주소의 마지막 조각은 보통 media id(UUID)라 사람이 읽을 이름이 아니다. 확장자가 있는 파일 이름만 보인다.
  const label = /\.[a-z0-9]{2,5}$/iu.test(name) ? name : null;
  const [index, setIndex] = useState<number | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label ? `첨부 이미지 크게 보기: ${label}` : "첨부 이미지 크게 보기"}
        onClick={(event) => {
          setReturnFocus(event.currentTarget);
          setIndex(0);
        }}
        className="mt-1 self-start cursor-zoom-in rounded-lg border border-border p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:mt-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 인증형 첨부 주소(/api/media)를 그대로 보여 준다. */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="block h-[120px] w-[160px] rounded-[7px] bg-muted object-cover"
        />
      </button>
      <ImageViewer
        images={[{ src, alt: label ?? "첨부 이미지" }]}
        index={index}
        onIndexChange={setIndex}
        returnFocus={returnFocus}
      />
    </>
  );
}
