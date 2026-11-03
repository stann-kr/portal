/**
 * 편집기 확장 목록(schema 포함). React 화면(FullEditor)과 서버 복원 변환(HTML ↔ Y.Doc)이 같은 schema를 쓰도록 분리했다.
 */
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import YoutubeExtension from "@tiptap/extension-youtube";
import { Table as TableExtension } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Typography from "@tiptap/extension-typography";
import { Markdown } from "tiptap-markdown";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { AnyExtension } from "@tiptap/core";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { common, createLowlight } from "lowlight";
import { GuideBlockId } from "./guide-block-id-extension";
import { LessonTimestamp } from "./lesson-timestamp-extension";

export type FullEditorCollaborator = { name: string; colorIndex: number };

export type FullEditorCollaboration = {
  doc: Y.Doc;
  field?: string;
  awareness?: Awareness | null;
  user: FullEditorCollaborator;
};

// ── lowlight 인스턴스 ─────────────────────────────

const lowlight = createLowlight(common);

// 저장 HTML에 임의 style을 남기지 않고 allowlist 가능한 semantic attribute만 사용한다.
const SafeTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element: HTMLElement) => {
              const alignment = element.getAttribute("data-text-align") ?? element.style.textAlign;
              return this.options.alignments.includes(alignment)
                ? alignment
                : this.options.defaultAlignment;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const alignment = attributes.textAlign;
              return typeof alignment === "string" && this.options.alignments.includes(alignment)
                ? { "data-text-align": alignment }
                : {};
            },
          },
        },
      },
    ];
  },
});

const SLASH_HINT = "'/'를 눌러 블록 추가";

const COLLABORATOR_COLOR_COUNT = 6;

export function collaboratorColorIndex(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value % COLLABORATOR_COLOR_COUNT : 0;
}

/** 다른 사람 커서: 색은 token class(globals.css `.collab-caret`)로만 정한다. */
function renderCollaboratorCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement("span");
  caret.className = "collab-caret";
  caret.setAttribute("data-collab-color", String(collaboratorColorIndex(user.colorIndex)));
  const label = document.createElement("span");
  label.className = "collab-caret-label";
  label.textContent = typeof user.name === "string" && user.name ? user.name : "다른 사용자";
  caret.append(label);
  return caret;
}

/**
 * 편집기 확장 목록. 공동 편집 시드(같은 schema로 HTML → Y.Doc)도 이 목록을 쓴다.
 */
export function createFullEditorExtensions({
  placeholder = "",
  preserveBlockIds = false,
  collaboration,
}: {
  placeholder?: string;
  preserveBlockIds?: boolean;
  collaboration?: FullEditorCollaboration;
} = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // CodeBlock은 CodeBlockLowlight로 교체
      codeBlock: false,
      // 공동 편집은 Collaboration의 실행 취소(내 입력만 되돌림)를 쓴다.
      undoRedo: collaboration ? false : undefined,
      // These extensions have their own configuration below in Tiptap v3.
      link: false,
      underline: false,
    }),
    Underline,
    Highlight.configure({ multicolor: false }),
    SafeTextAlign.configure({ types: ["heading", "paragraph"] }),
    LinkExtension.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        class: "text-primary underline underline-offset-2 cursor-pointer",
      },
    }),
    ImageExtension.configure({
      inline: false,
      // 기존 문서에 저장된 data URL 이미지를 편집 시 삭제하지 않는다.
      // 새 이미지 삽입 UI는 http(s) URL만 허용해 신규 base64 생성을 막는다.
      allowBase64: true,
      HTMLAttributes: {
        class: "rounded-lg max-w-full my-2",
      },
    }),
    YoutubeExtension.configure({
      controls: true,
      nocookie: true,
      HTMLAttributes: {
        class: "rounded-lg my-2",
      },
    }),
    TableExtension.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({
      lowlight,
      HTMLAttributes: {
        class: "not-prose",
      },
    }),
    // 빈 문서는 화면이 정한 안내를, 내용이 있는 문서의 빈 줄(커서 위치)은 `/` 블록 안내를 보인다.
    Placeholder.configure({
      placeholder: ({ editor: currentEditor }) => (currentEditor.isEmpty ? placeholder : SLASH_HINT),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Typography,
    Markdown.configure({
      html: true,
      tightLists: true,
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
    // 수업 시점 `[12:34]` 표시(decoration만, schema 변경 없음)
    LessonTimestamp,
    ...(preserveBlockIds ? [GuideBlockId] : []),
    ...(collaboration
      ? [
          Collaboration.configure({ document: collaboration.doc, field: collaboration.field ?? "default" }),
          ...(collaboration.awareness
            ? [
                CollaborationCaret.configure({
                  provider: { awareness: collaboration.awareness },
                  user: collaboration.user,
                  render: renderCollaboratorCaret,
                  selectionRender: (user: Record<string, unknown>) => ({
                    class: "collab-selection",
                    "data-collab-color": String(collaboratorColorIndex(user.colorIndex)),
                  }),
                }),
              ]
            : []),
        ]
      : []),
  ];
}
