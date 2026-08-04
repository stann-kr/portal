import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Table,
} from "lucide-react";

export type EditorBlockCommand = {
  id: string;
  label: string;
  description: string;
  keywords: readonly string[];
  Icon: LucideIcon;
  run: (editor: Editor) => void;
};

export const EDITOR_BLOCK_COMMANDS: readonly EditorBlockCommand[] = [
  {
    id: "paragraph",
    label: "본문",
    description: "일반 텍스트 블록",
    keywords: ["paragraph", "text", "p", "본문", "텍스트"],
    Icon: Pilcrow,
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "heading-1",
    label: "제목 1",
    description: "큰 구역 제목",
    keywords: ["heading", "h1", "title", "제목"],
    Icon: Heading1,
    run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "제목 2",
    description: "중간 구역 제목",
    keywords: ["heading", "h2", "subtitle", "제목"],
    Icon: Heading2,
    run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "제목 3",
    description: "작은 구역 제목",
    keywords: ["heading", "h3", "제목"],
    Icon: Heading3,
    run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet-list",
    label: "글머리 목록",
    description: "순서 없는 항목",
    keywords: ["bullet", "list", "ul", "목록"],
    Icon: List,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "번호 목록",
    description: "순서가 있는 항목",
    keywords: ["ordered", "number", "list", "ol", "번호", "목록"],
    Icon: ListOrdered,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task-list",
    label: "체크리스트",
    description: "완료 여부를 표시하는 항목",
    keywords: ["task", "todo", "check", "체크", "할 일"],
    Icon: ListTodo,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "blockquote",
    label: "인용구",
    description: "강조해서 인용할 문장",
    keywords: ["quote", "blockquote", "인용"],
    Icon: Quote,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code-block",
    label: "코드 블록",
    description: "고정폭 텍스트 영역",
    keywords: ["code", "pre", "코드"],
    Icon: Code2,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "구분선",
    description: "내용 사이를 나누는 선",
    keywords: ["divider", "rule", "hr", "구분선"],
    Icon: Minus,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "표",
    description: "3 × 3 표",
    keywords: ["table", "grid", "표"],
    Icon: Table,
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

export function filterEditorBlockCommands(query: string): readonly EditorBlockCommand[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) return EDITOR_BLOCK_COMMANDS;

  return EDITOR_BLOCK_COMMANDS.filter((command) => {
    const searchable = [command.label, command.description, ...command.keywords]
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    return searchable.includes(normalizedQuery);
  });
}

export type SlashCommandMatch = {
  from: number;
  to: number;
  query: string;
};

export function findSlashCommandMatch(editor: Editor): SlashCommandMatch | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;

  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return null;

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const match = textBeforeCursor.match(/(?:^|\s)\/([^\s/]*)$/u);
  if (!match) return null;

  const slashOffset = match[0].lastIndexOf("/");
  const from = selection.from - (match[0].length - slashOffset);

  return {
    from,
    to: selection.from,
    query: match[1] ?? "",
  };
}
