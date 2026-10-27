import { Extension } from "@tiptap/react";

/** 가이드 질문 위치가 가리키는 블록 node. 서버 `ensureGuideBlockIds`와 같은 범위다. */
export const GUIDE_BLOCK_ID_NODE_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "table",
  "image",
  "horizontalRule",
] as const;

const SAFE_BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * 가이드 편집에서만 쓰는 전역 속성: 블록의 `data-block-id`를 편집 중에도 보존한다.
 * 문단을 나눌 때 새 문단에는 복사하지 않는다(서버가 없는 식별자를 새로 준다).
 */
export const GuideBlockId = Extension.create({
  name: "guideBlockId",
  addGlobalAttributes() {
    return [
      {
        types: [...GUIDE_BLOCK_ID_NODE_TYPES],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-block-id");
              return value && SAFE_BLOCK_ID.test(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.blockId === "string" && SAFE_BLOCK_ID.test(attributes.blockId)
                ? { "data-block-id": attributes.blockId }
                : {},
          },
        },
      },
    ];
  },
});
