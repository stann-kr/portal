/**
 * @file src/components/editor/FullEditor.tsx
 * @description 풀 사양 리치텍스트 에디터.
 * Tiptap v3 기반. 헤딩/리스트/코드블록/테이블/링크/이미지/유튜브/마크다운 지원.
 * WYSIWYG ↔ 마크다운 모드 토글 포함.
 */
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
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
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { useState, useCallback, useEffect } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3, List, ListOrdered, ListTodo,
  Quote, Code2, Link as LinkIcon, Image as ImageIcon, Video,
  Table as TableIcon, AlignLeft, AlignCenter, AlignRight,
  Minus, Undo2, Redo2, FileText, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── 타입 ──────────────────────────────────────────

interface FullEditorProps {
  /** 초기 HTML 콘텐츠 (편집 모드) */
  initialContent?: string;
  /** 콘텐츠 변경 시 HTML 문자열 전달 */
  onChange?: (html: string) => void;
  placeholder?: string;
  /** 에디터 최소 높이 (CSS 값) */
  minHeight?: string;
  disabled?: boolean;
}

// ── lowlight 인스턴스 ─────────────────────────────

const lowlight = createLowlight(common);

// ── 툴바 버튼 헬퍼 ───────────────────────────────

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        "p-1.5 rounded text-sm transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-accent",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-border mx-0.5 flex-shrink-0" />;
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function FullEditor({
  initialContent = "",
  onChange,
  placeholder = "내용을 입력하세요... (/ 로 블록 삽입)",
  minHeight = "calc(100vh - 320px)",
  disabled = false,
}: FullEditorProps) {
  const [isMarkdownMode, setIsMarkdownMode] = useState(false);
  const [markdownText, setMarkdownText] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // CodeBlock은 CodeBlockLowlight로 교체
        codeBlock: false,
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 cursor-pointer",
        },
      }),
      ImageExtension.configure({
        inline: false,
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
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: true,
        tightLists: true,
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: false,
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none p-6 text-foreground",
      },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML());
    },
  });

  // initialContent 변경 시 에디터 콘텐츠 갱신 (편집 모드 진입)
  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent]);

  // ── 마크다운 모드 토글 ────────────────────────────

  const handleMarkdownToggle = useCallback(() => {
    if (!editor) return;

    if (!isMarkdownMode) {
      // WYSIWYG → 마크다운
      const editorStorage = editor.storage as unknown as Record<string, unknown>;
      const markdownStorage = editorStorage.markdown as MarkdownStorage | undefined;
      const md = markdownStorage?.getMarkdown?.() ?? editor.getHTML();
      setMarkdownText(md);
      setIsMarkdownMode(true);
    } else {
      // 마크다운 → WYSIWYG
      editor.commands.setContent(markdownText);
      onChange?.(editor.getHTML());
      setIsMarkdownMode(false);
    }
  }, [editor, isMarkdownMode, markdownText, onChange]);

  const handleMarkdownChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMarkdownText(e.target.value);
  };

  // ── 링크 삽입 ─────────────────────────────────────

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("링크 URL 입력:");
    if (!url) return;
    if (editor.state.selection.empty) {
      const text = window.prompt("링크 텍스트 입력:", url) ?? url;
      editor.chain().focus().insertContent(`<a href="${url}">${text}</a>`).run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  // ── 이미지 삽입 ───────────────────────────────────

  const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("이미지 URL 입력:");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  // ── 유튜브 삽입 ───────────────────────────────────

  const addYoutube = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("YouTube URL 입력:");
    if (url) editor.commands.setYoutubeVideo({ src: url });
  }, [editor]);

  // ── 테이블 삽입 ───────────────────────────────────

  const addTable = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="border border-border rounded-xl bg-background overflow-hidden flex flex-col focus-within:ring-1 focus-within:ring-foreground/20 transition-all">

      {/* ── 툴바 ──────────────────────────────────── */}
      <div
        role="toolbar"
        aria-label="편집 도구"
        className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-border bg-muted/40 flex-shrink-0"
      >
        {/* 실행 취소 / 다시 실행 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="실행 취소 (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="다시 실행 (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 헤딩 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setParagraph().run()}
          active={editor.isActive("paragraph")}
          title="본문"
        >
          <span className="text-xs font-medium w-4 text-center">P</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="제목 1 (H1)"
        >
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="제목 2 (H2)"
        >
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="제목 3 (H3)"
        >
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 인라인 서식 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="굵게 (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="기울임 (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="밑줄 (Ctrl+U)"
        >
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="취소선"
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive("highlight")}
          title="형광펜"
        >
          <Highlighter className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 정렬 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="왼쪽 정렬"
        >
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="가운데 정렬"
        >
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="오른쪽 정렬"
        >
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 리스트 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="글머리 기호 목록"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="번호 매기기 목록"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive("taskList")}
          title="체크리스트"
        >
          <ListTodo className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 블록 요소 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="인용구"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          title="코드 블록"
        >
          <Code2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="구분선"
        >
          <Minus className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 미디어 / 링크 */}
        <ToolbarButton
          onClick={addLink}
          active={editor.isActive("link")}
          title="링크 삽입"
        >
          <LinkIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={addImage}
          title="이미지 삽입"
        >
          <ImageIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={addYoutube}
          title="유튜브 동영상 삽입"
        >
          <Video className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={addTable}
          active={editor.isActive("table")}
          title="표 삽입"
        >
          <TableIcon className="w-4 h-4" />
        </ToolbarButton>

        {/* 마크다운 모드 토글 */}
        <div className="ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleMarkdownToggle}
            className={[
              "h-7 gap-1.5 text-xs",
              isMarkdownMode ? "text-primary" : "text-muted-foreground",
            ].join(" ")}
            title="마크다운 / WYSIWYG 전환"
          >
            {isMarkdownMode ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                미리보기
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5" />
                마크다운
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── 에디터 / 마크다운 영역 ─────────────────── */}
      {isMarkdownMode ? (
        <textarea
          value={markdownText}
          onChange={handleMarkdownChange}
          className="flex-1 w-full p-6 font-mono text-sm text-foreground bg-background resize-none focus:outline-none leading-relaxed"
          style={{ minHeight }}
          placeholder="마크다운으로 작성하세요..."
        />
      ) : (
        <div
          className="flex-1 overflow-auto cursor-text"
          style={{ minHeight }}
          onClick={() => editor.commands.focus()}
        >
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}
