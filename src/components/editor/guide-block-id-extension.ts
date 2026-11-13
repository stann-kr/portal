import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { createRandomGuideBlockId } from "@/lib/guide-block-id";

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
const BLOCK_TYPES = new Set<string>(GUIDE_BLOCK_ID_NODE_TYPES);

function isBlockId(value: unknown): value is string {
  return typeof value === "string" && SAFE_BLOCK_ID.test(value);
}

/** 다른 기기에서 온 변경과 공동 편집 첫 동기화는 y-sync가 표시한다. 그런 변경만 있으면 식별자를 쓰지 않는다. */
function hasLocalDocChange(transactions: readonly Transaction[]): boolean {
  return transactions.some((transaction) => {
    if (!transaction.docChanged) return false;
    const sync = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
    return !sync?.isChangeOrigin;
  });
}

/**
 * 가이드 편집에서만 쓰는 전역 속성: 블록의 `data-block-id`를 편집 중에도 보존한다.
 * 문단을 나눌 때 새 문단에는 복사하지 않는다(keepOnSplit=false).
 *
 * 공동 편집 room(Y.Doc)에는 저장 응답의 식별자가 다시 들어가지 않는다. 그래서 식별자가 없거나 앞 블록과 겹치는
 * 블록에는 블록을 만든 기기의 편집기가 바로 새 식별자를 준다. 서버 규칙과 같게 처음 나온 블록이 식별자를 지킨다.
 * 식별자는 room에 남아 다른 기기와 다음 저장에도 같은 값으로 나가, 학생 질문 위치가 저장마다 끊기지 않는다.
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
              return isBlockId(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              isBlockId(attributes.blockId) ? { "data-block-id": attributes.blockId } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("guideBlockIdAssign"),
        appendTransaction(transactions, _oldState, state) {
          if (!hasLocalDocChange(transactions)) return null;
          const used = new Set<string>();
          state.doc.descendants((node) => {
            if (BLOCK_TYPES.has(node.type.name) && isBlockId(node.attrs.blockId)) used.add(node.attrs.blockId);
          });
          const kept = new Set<string>();
          let transaction: Transaction | null = null;
          state.doc.descendants((node, position) => {
            if (!BLOCK_TYPES.has(node.type.name)) return;
            const current = node.attrs.blockId;
            if (isBlockId(current) && !kept.has(current)) {
              kept.add(current);
              return;
            }
            let next = createRandomGuideBlockId();
            while (used.has(next)) next = createRandomGuideBlockId();
            used.add(next);
            kept.add(next);
            transaction ??= state.tr;
            transaction.setNodeAttribute(position, "blockId", next);
          });
          return transaction;
        },
      }),
    ];
  },
});
