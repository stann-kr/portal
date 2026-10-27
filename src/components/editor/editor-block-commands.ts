import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image,
  ImagePlus,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Table,
  Video,
} from "lucide-react";

/** 편집기 밖에서 여는 기능(파일 선택·주소 입력 패널). 문서 페이지처럼 고정 도구 줄이 없는 편집기가 slash 명령으로 쓴다. */
export type EditorBlockCommandContext = {
  pickImages: () => void;
  openInsertPanel: (kind: "link" | "image" | "youtube") => void;
};

export type EditorBlockCommand = {
  id: string;
  label: string;
  description: string;
  keywords: readonly string[];
  Icon: LucideIcon;
  /** true면 `EditorBlockCommandContext`가 있는 편집기에서만 보인다. */
  needsContext?: boolean;
  run: (editor: Editor, context?: EditorBlockCommandContext) => void;
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
  {
    id: "image-upload",
    label: "이미지 올리기",
    description: "기기에서 사진 선택",
    keywords: ["image", "photo", "upload", "이미지", "사진", "그림"],
    Icon: ImagePlus,
    needsContext: true,
    run: (_editor, context) => context?.pickImages(),
  },
  {
    id: "image-url",
    label: "이미지 주소",
    description: "웹 이미지 주소로 넣기",
    keywords: ["image", "url", "이미지", "주소", "그림"],
    Icon: Image,
    needsContext: true,
    run: (_editor, context) => context?.openInsertPanel("image"),
  },
  {
    id: "youtube",
    label: "YouTube 동영상",
    description: "동영상 주소로 넣기",
    keywords: ["youtube", "video", "영상", "동영상", "유튜브"],
    Icon: Video,
    needsContext: true,
    run: (_editor, context) => context?.openInsertPanel("youtube"),
  },
  {
    id: "link",
    label: "링크",
    description: "주소 연결",
    keywords: ["link", "url", "링크", "주소"],
    Icon: Link,
    needsContext: true,
    run: (_editor, context) => context?.openInsertPanel("link"),
  },
  {
    id: "align-left",
    label: "왼쪽 정렬",
    description: "문단을 왼쪽에 맞춤",
    keywords: ["align", "left", "정렬", "왼쪽"],
    Icon: AlignLeft,
    run: (editor) => editor.chain().focus().setTextAlign("left").run(),
  },
  {
    id: "align-center",
    label: "가운데 정렬",
    description: "문단을 가운데에 맞춤",
    keywords: ["align", "center", "정렬", "가운데"],
    Icon: AlignCenter,
    run: (editor) => editor.chain().focus().setTextAlign("center").run(),
  },
  {
    id: "align-right",
    label: "오른쪽 정렬",
    description: "문단을 오른쪽에 맞춤",
    keywords: ["align", "right", "정렬", "오른쪽"],
    Icon: AlignRight,
    run: (editor) => editor.chain().focus().setTextAlign("right").run(),
  },
];

export function filterEditorBlockCommands(
  query: string,
  options: { withContext?: boolean } = {},
): readonly EditorBlockCommand[] {
  const available = options.withContext
    ? EDITOR_BLOCK_COMMANDS
    : EDITOR_BLOCK_COMMANDS.filter((command) => !command.needsContext);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) return available;

  return available.filter((command) => {
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

/**
 * 슬래시 명령 검색어의 최대 길이.
 * 직전 경계 문자와 `/`까지 최대 66자만 읽어 긴 단일 문단에서도 transaction 비용을 제한한다.
 */
export const EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH = 64;

export function findSlashCommandMatch(editor: Editor): SlashCommandMatch | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;

  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return null;

  const scanLength = EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH + 2;
  const scanFrom = Math.max(0, $from.parentOffset - scanLength);
  const textBeforeCursor = $from.parent.textBetween(
    scanFrom,
    $from.parentOffset,
    undefined,
    "\ufffc",
  );
  const match = textBeforeCursor.match(/(?:^|\s)\/([^\s/]*)$/u);
  if (!match) return null;

  const query = match[1] ?? "";
  if (query.length > EDITOR_SLASH_COMMAND_MAX_QUERY_LENGTH) return null;

  const slashOffset = match[0].lastIndexOf("/");
  const from = selection.from - (match[0].length - slashOffset);

  return {
    from,
    to: selection.from,
    query,
  };
}
