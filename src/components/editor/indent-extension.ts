/**
 * 편집기 안 Tab·Shift+Tab. 전에는 목록·표 밖에서 Tab을 누르면 브라우저 기본 동작으로 초점이 편집기 밖(수업 도구 버튼 등)으로 나갔다.
 * - 목록·할 일 항목: 목록 확장이 단계를 바꾼다. 더 못 바꿔도(첫 항목) 초점을 내보내지 않는다.
 * - 표: 표 확장이 다음 칸으로 옮긴다(이 확장보다 먼저 처리된다).
 * - 코드 블록: 공백 2칸을 넣는다(Shift+Tab은 아무것도 하지 않는다).
 * - 문단·제목: 들여쓰기 단계(1~6)를 올리고 내린다. 저장 HTML에는 `data-indent`만 남긴다(sanitize-html allowlist, globals.css가 그린다).
 * 키보드 사용자는 Esc로 편집 영역 초점을 놓고 Tab으로 다음 조작으로 간다.
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

export const MAX_INDENT = 6;
const INDENT_TYPES = ["paragraph", "heading"] as const;

export function parseIndent(value: string | null | undefined): number {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= MAX_INDENT ? level : 0;
}

function inList(editor: Editor) {
  return editor.isActive("listItem") || editor.isActive("taskItem");
}

function changeIndent(editor: Editor, delta: 1 | -1): boolean {
  const { state, view } = editor;
  const { from, to } = state.selection;
  let tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!(INDENT_TYPES as readonly string[]).includes(node.type.name)) return true;
    const current = parseIndent(String(node.attrs.indent ?? 0));
    const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
    if (next !== current) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next || null });
      changed = true;
    }
    return false;
  });
  if (changed) view.dispatch(tr);
  return true;
}

export const Indent = Extension.create({
  name: "indent",
  // 목록·표 확장(기본 100)이 먼저 Tab을 처리하게 낮춘다.
  priority: 50,

  addGlobalAttributes() {
    return [
      {
        types: [...INDENT_TYPES],
        attributes: {
          // 기본값은 null: y-prosemirror는 null 속성을 공동 편집 문서에 쓰지 않는다. 0을 쓰면 이 속성이 없던 기존 문서와
          // 새로 편집한 문단이 서로 다른 블록으로 비교돼 오프라인 입력을 합칠 때 본문이 겹쳤다.
          indent: {
            default: null,
            parseHTML: (element: HTMLElement) => parseIndent(element.getAttribute("data-indent")) || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const level = parseIndent(String(attributes.indent ?? 0));
              return level ? { "data-indent": String(level) } : {};
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const editor = this.editor;
        if (!editor.isEditable) return false;
        if (inList(editor)) return editor.commands.sinkListItem(editor.isActive("taskItem") ? "taskItem" : "listItem") || true;
        // insertContent에 문자열을 주면 tiptap-markdown이 markdown으로 다시 읽어 공백만 있는 입력이 사라진다.
        if (editor.isActive("codeBlock")) {
          return editor.commands.command(({ tr, dispatch }) => {
            if (dispatch) tr.insertText("  ");
            return true;
          });
        }
        return changeIndent(editor, 1);
      },
      "Shift-Tab": () => {
        const editor = this.editor;
        if (!editor.isEditable) return false;
        if (inList(editor)) return editor.commands.liftListItem(editor.isActive("taskItem") ? "taskItem" : "listItem") || true;
        if (editor.isActive("codeBlock")) return true;
        return changeIndent(editor, -1);
      },
      // 편집 영역에서 나가는 키보드 경로(Tab은 편집기 안에서 쓰인다).
      Escape: () => {
        const editor = this.editor;
        if (!editor.isFocused) return false;
        editor.commands.blur();
        return true;
      },
    };
  },
});
