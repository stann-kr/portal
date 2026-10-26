/**
 * @file src/components/editor/FullEditor.tsx
 * @description 풀 사양 리치텍스트 에디터.
 * Tiptap v3 기반. 헤딩/리스트/코드블록/테이블/링크/이미지/유튜브/마크다운 지원.
 * WYSIWYG ↔ 마크다운 모드 토글 포함.
 */
"use client";

import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
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
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import type { Editor } from "@tiptap/core";
import { common, createLowlight } from "lowlight";
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3, List, ListOrdered, ListTodo,
  Quote, Code2, Link as LinkIcon, Image as ImageIcon, ImagePlus, Video,
  Table as TableIcon, AlignLeft, AlignCenter, AlignRight,
  Minus, Undo2, Redo2, FileText, Eye, Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BlockCommandMenu } from "./BlockCommandMenu";
import {
  EditorInsertPanel,
  type EditorInsertKind,
  type EditorSelection,
} from "./EditorInsertPanel";
import { createDeferredDocumentSerializer } from "@/lib/deferred-document-serializer";
import {
  EDITOR_IMAGE_ACCEPT,
  abandonEditorImage,
  isEditorImageFile,
  pastedEditorImageFiles,
  useEditorImageUpload,
  type EditorUploadedImage,
} from "./useEditorImageUpload";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";

// ── 타입 ──────────────────────────────────────────

interface FullEditorProps {
  /** 초기 HTML 콘텐츠 (편집 모드) */
  initialContent?: string;
  /** 콘텐츠 변경 시 HTML 문자열 전달 */
  onChange?: (html: string) => void;
  /** 문서가 바뀌었을 때 최신 HTML을 지연해서 읽을 수 있는 reader 전달 */
  onDirty?: (readLatestHtml: () => string) => void;
  /** 같은 HTML 값으로도 명시적 복원·초기화를 강제하는 version */
  contentVersion?: number;
  placeholder?: string;
  /** 에디터 최소 높이 (CSS 값) */
  minHeight?: string;
  disabled?: boolean;
  /** contenteditable의 접근 가능한 이름 */
  ariaLabel?: string;
  /** draft 저장 상태·단축키 안내 등을 표시하는 하단 슬롯 */
  footer?: ReactNode;
  /** 상위 form이 제공하는 Cmd/Ctrl+S 동작의 정확한 사용자-facing 이름 */
  saveShortcutLabel?: string;
  /**
   * boxed: 테두리 상자 안의 편집기(댓글·작은 form).
   * page: 문서 페이지 본문. 테두리 없이 쓰고 편집 도구 줄은 스크롤해도 위에 남는다.
   */
  variant?: "boxed" | "page";
  /** 본문 이미지가 올라가는 중이거나 넣기를 기다리는 동안 true. 상위 form은 제출·자동 저장을 미룬다. */
  onUploadingChange?: (uploading: boolean) => void;
}

/** 마크다운 이미지 문법을 깨지 않도록 대체 텍스트의 특수 문자를 정리한다. */
function markdownImageAlt(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replace(/([\\[\]()])/gu, "\\$1");
}

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
  onDirty,
  contentVersion = 0,
  placeholder = "내용을 입력하세요... (/ 로 블록 삽입)",
  minHeight = "calc(100vh - 320px)",
  disabled = false,
  ariaLabel = "문서 내용",
  footer,
  saveShortcutLabel,
  variant = "boxed",
  onUploadingChange,
}: FullEditorProps) {
  const isPage = variant === "page";
  const [isMarkdownMode, setIsMarkdownMode] = useState(false);
  const [markdownText, setMarkdownText] = useState("");
  const [insertPanel, setInsertPanel] = useState<{
    kind: EditorInsertKind;
    selection: EditorSelection;
  } | null>(null);
  const lastLocalHtmlRef = useRef(initialContent);
  const lastNotifiedHtmlRef = useRef(initialContent);
  const editorInstanceRef = useRef<Editor | null>(null);
  const markdownModeRef = useRef(false);
  const markdownTextRef = useRef("");
  const documentSerializerRef = useRef(
    createDeferredDocumentSerializer(initialContent),
  );
  const onChangeRef = useRef(onChange);
  const onDirtyRef = useRef(onDirty);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 편집기 생성 때만 쓰는 첫 본문. 이후 본문 교체는 아래 동기화 effect가 맡는다.
  const [initialEditorContent] = useState(initialContent);
  const appliedContentVersionRef = useRef(contentVersion);
  // 최신 콜백을 다른 effect·편집기 이벤트보다 먼저 반영한다.
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onDirtyRef.current = onDirty;
  }, [onChange, onDirty]);

  const readLatestHtml = useCallback(() => {
    const currentEditor = editorInstanceRef.current;
    const html = documentSerializerRef.current.read(() => {
      if (!currentEditor) return lastLocalHtmlRef.current;
      if (markdownModeRef.current) {
        currentEditor.commands.setContent(markdownTextRef.current, {
          emitUpdate: false,
        });
      }
      return currentEditor.getHTML();
    });
    lastLocalHtmlRef.current = html;
    return html;
  }, []);

  const publishLatestHtml = useCallback(() => {
    changeTimerRef.current = null;
    const html = readLatestHtml();
    if (lastNotifiedHtmlRef.current === html) return;
    lastNotifiedHtmlRef.current = html;
    onChangeRef.current?.(html);
  }, [readLatestHtml]);

  const markContentDirty = useCallback(() => {
    documentSerializerRef.current.markDirty();
    onDirtyRef.current?.(readLatestHtml);
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(publishLatestHtml, 200);
  }, [publishLatestHtml, readLatestHtml]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  // 본문을 다른 초안으로 바꾸거나 편집기가 사라지면 세대를 올려, 그 전에 시작한 업로드를 넣지 않는다.
  const contentGenerationRef = useRef(0);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);
  // 저장 중처럼 잠긴 동안 끝난 업로드는 잠금이 풀린 뒤 넣는다.
  const deferredImagesRef = useRef<EditorUploadedImage[]>([]);
  const [deferredImageCount, setDeferredImageCount] = useState(0);

  const insertImageNow = useCallback(
    (upload: EditorUploadedImage) => {
      const alt = upload.file.name.replace(/\.[^.]+$/u, "");
      if (markdownModeRef.current) {
        // 마크다운 모드에서는 textarea가 원본이므로 그 끝에 이미지를 붙인다.
        const nextMarkdown = `${markdownTextRef.current.trimEnd()}\n\n![${markdownImageAlt(alt)}](${upload.deliveryUrl})\n`;
        markdownTextRef.current = nextMarkdown;
        setMarkdownText(nextMarkdown);
        markContentDirty();
        return;
      }
      // 다른 입력란의 포커스를 빼앗지 않고 현재 선택의 뒤에 넣는다.
      // 앞서 넣은 이미지가 선택된 채여도 바꾸지 않고 그 뒤에 이어 붙인다.
      const currentEditor = editorInstanceRef.current;
      if (!currentEditor) return;
      currentEditor
        .chain()
        .insertContentAt(currentEditor.state.selection.to, {
          type: "image",
          attrs: { src: upload.deliveryUrl, alt: alt || null },
        })
        .run();
    },
    [markContentDirty],
  );

  const discardDeferredImages = useCallback(() => {
    for (const upload of deferredImagesRef.current) abandonEditorImage(upload.mediaObjectId);
    deferredImagesRef.current = [];
    setDeferredImageCount(0);
  }, []);

  const handleUploadedImage = useCallback(
    (upload: EditorUploadedImage, generation: number) => {
      if (generation !== contentGenerationRef.current || !editorInstanceRef.current) {
        abandonEditorImage(upload.mediaObjectId);
        return;
      }
      if (disabledRef.current) {
        deferredImagesRef.current.push(upload);
        setDeferredImageCount(deferredImagesRef.current.length);
        return;
      }
      insertImageNow(upload);
    },
    [insertImageNow],
  );
  const imageUpload = useEditorImageUpload<number>(handleUploadedImage);
  const uploadImagesForCurrentContent = imageUpload.uploadImages;
  const uploadImages = useCallback(
    (files: readonly File[]) => uploadImagesForCurrentContent(files, contentGenerationRef.current),
    [uploadImagesForCurrentContent],
  );
  const imageUploadBusy = imageUpload.pendingCount > 0 || deferredImageCount > 0;
  useBusyNavigationGuard(imageUploadBusy);
  const onUploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange;
  }, [onUploadingChange]);
  useEffect(() => {
    onUploadingChangeRef.current?.(imageUploadBusy);
  }, [imageUploadBusy]);
  useEffect(() => () => onUploadingChangeRef.current?.(false), []);
  const editorExtensions = useMemo(
    () => [
      StarterKit.configure({
        // CodeBlock은 CodeBlockLowlight로 교체
        codeBlock: false,
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
      Placeholder.configure({ placeholder }),
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
    ],
    [placeholder],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        class: isPage
          ? "max-w-none py-5 text-foreground focus:outline-none"
          : "max-w-none p-5 text-foreground focus:outline-none sm:p-6",
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
      },
      // 붙여넣거나 끌어 놓은 이미지 파일은 data URL 대신 업로드한 주소로 넣는다.
      handlePaste: (_view: unknown, event: ClipboardEvent) => {
        // 표·문서에서 복사하면 글과 함께 미리보기 그림이 들어온다. 이때는 글을 붙인다.
        const files = pastedEditorImageFiles(event.clipboardData);
        if (!files) return false;
        event.preventDefault();
        uploadImages(files);
        return true;
      },
      handleDrop: (
        view: { posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null },
        event: DragEvent,
        _slice: unknown,
        moved: boolean,
      ) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.some(isEditorImageFile)) return false;
        event.preventDefault();
        const dropPosition = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (dropPosition) {
          editorInstanceRef.current?.commands.setTextSelection(dropPosition.pos);
        }
        uploadImages(files);
        return true;
      },
    }),
    [ariaLabel, isPage, uploadImages],
  );

  const handleEditorUpdate = useCallback(
    ({ editor, transaction }: { editor: Editor; transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      editorInstanceRef.current = editor;
      markContentDirty();
    },
    [markContentDirty],
  );
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    extensions: editorExtensions,
    content: initialEditorContent,
    editorProps,
    onUpdate: handleEditorUpdate,
  });
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      canRedo: currentEditor?.can().redo() ?? false,
      canUndo: currentEditor?.can().undo() ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
      bold: currentEditor?.isActive("bold") ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      codeBlock: currentEditor?.isActive("codeBlock") ?? false,
      heading1: currentEditor?.isActive("heading", { level: 1 }) ?? false,
      heading2: currentEditor?.isActive("heading", { level: 2 }) ?? false,
      heading3: currentEditor?.isActive("heading", { level: 3 }) ?? false,
      highlight: currentEditor?.isActive("highlight") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      link: currentEditor?.isActive("link") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      paragraph: currentEditor?.isActive("paragraph") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      table: currentEditor?.isActive("table") ?? false,
      taskList: currentEditor?.isActive("taskList") ?? false,
      textAlignCenter: currentEditor?.isActive({ textAlign: "center" }) ?? false,
      textAlignLeft: currentEditor?.isActive({ textAlign: "left" }) ?? false,
      textAlignRight: currentEditor?.isActive({ textAlign: "right" }) ?? false,
      underline: currentEditor?.isActive("underline") ?? false,
    }),
  });

  useEffect(() => {
    editorInstanceRef.current = editor;
    return () => {
      if (editorInstanceRef.current === editor) {
        readLatestHtml();
        editorInstanceRef.current = null;
      }
    };
  }, [editor, readLatestHtml]);

  // draft 복원·다른 문서 전환·저장 후 초기화를 모두 동기화한다.
  useEffect(() => {
    if (!editor) return;
    const nextContent = initialContent || "";
    const explicitContentReset =
      contentVersion !== appliedContentVersionRef.current;
    appliedContentVersionRef.current = contentVersion;
    if (
      !explicitContentReset &&
      (nextContent === lastLocalHtmlRef.current ||
        nextContent === lastNotifiedHtmlRef.current)
    ) return;
    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
      changeTimerRef.current = null;
    }
    contentGenerationRef.current += 1;
    discardDeferredImages();
    editor.commands.setContent(nextContent, { emitUpdate: false });
    documentSerializerRef.current.replace(nextContent);
    lastLocalHtmlRef.current = nextContent;
    lastNotifiedHtmlRef.current = nextContent;
    if (isMarkdownMode) {
      const editorStorage = editor.storage as unknown as Record<string, unknown>;
      const markdownStorage = editorStorage.markdown as MarkdownStorage | undefined;
      const nextMarkdown = markdownStorage?.getMarkdown?.() ?? editor.getHTML();
      markdownTextRef.current = nextMarkdown;
      // textarea 표시값은 편집기에서 다시 읽어 ref에 둔 마크다운을 그대로 따른다.
      setMarkdownText(markdownTextRef.current);
    }
  }, [contentVersion, discardDeferredImages, editor, initialContent, isMarkdownMode]);

  // 잠기면 열린 삽입 패널을 그 렌더에서 바로 닫는다.
  if (disabled && insertPanel) setInsertPanel(null);

  useEffect(() => {
    editor?.setEditable(!disabled, false);
    if (disabled) return;
    const deferred = deferredImagesRef.current;
    if (deferred.length === 0) return;
    deferredImagesRef.current = [];
    // 보류 개수는 방금 비운 ref를 따른다(0). 이미지를 편집기에 넣은 뒤 상위 form이 업로드 끝을 받는 순서는 아래 insert가 지킨다.
    setDeferredImageCount(deferredImagesRef.current.length);
    for (const upload of deferred) insertImageNow(upload);
  }, [disabled, editor, insertImageNow]);

  useEffect(
    () => () => {
      contentGenerationRef.current += 1;
      for (const upload of deferredImagesRef.current) abandonEditorImage(upload.mediaObjectId);
      deferredImagesRef.current = [];
    },
    [],
  );

  useEffect(() => () => {
    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
    }
  }, []);

  // ── 마크다운 모드 토글 ────────────────────────────

  const handleMarkdownToggle = useCallback(() => {
    if (!editor || disabled) return;

    if (!isMarkdownMode) {
      // WYSIWYG → 마크다운
      const editorStorage = editor.storage as unknown as Record<string, unknown>;
      const markdownStorage = editorStorage.markdown as MarkdownStorage | undefined;
      const md = markdownStorage?.getMarkdown?.() ?? editor.getHTML();
      markdownModeRef.current = true;
      markdownTextRef.current = md;
      setMarkdownText(md);
      setIsMarkdownMode(true);
    } else {
      // 마크다운 → WYSIWYG
      readLatestHtml();
      markdownModeRef.current = false;
      setIsMarkdownMode(false);
      publishLatestHtml();
    }
  }, [disabled, editor, isMarkdownMode, publishLatestHtml, readLatestHtml]);

  const handleMarkdownChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const nextMarkdown = e.target.value;
    markdownTextRef.current = nextMarkdown;
    setMarkdownText(nextMarkdown);
    markContentDirty();
  };

  const openInsertPanel = useCallback(
    (kind: EditorInsertKind) => {
      if (!editor || disabled) return;
      const { from, to } = editor.state.selection;
      setInsertPanel({ kind, selection: { from, to } });
    },
    [disabled, editor],
  );

  // ── 테이블 삽입 ───────────────────────────────────

  const addTable = useCallback(() => {
    if (!editor || disabled) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [disabled, editor]);

  if (!editor) return null;

  return (
    <div
      className={
        isPage
          ? "relative flex flex-col bg-background"
          : "relative flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15"
      }
    >

      {!isMarkdownMode && !disabled ? (
        <>
          <BubbleMenu
            editor={editor}
            pluginKey="editor-inline-format-menu"
            updateDelay={80}
            options={{ placement: "top", offset: 8 }}
            className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated p-1 shadow-floating"
          >
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={toolbarState?.bold}
              title="굵게"
            >
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={toolbarState?.italic}
              title="기울임"
            >
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              active={toolbarState?.underline}
              title="밑줄"
            >
              <UnderlineIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => openInsertPanel("link")}
              active={toolbarState?.link}
              title="링크"
            >
              <LinkIcon className="h-4 w-4" />
            </ToolbarButton>
            {toolbarState?.link ? (
              <ToolbarButton
                onClick={() => editor.chain().focus().unsetLink().run()}
                title="링크 제거"
              >
                <Unlink className="h-4 w-4" />
              </ToolbarButton>
            ) : null}
          </BubbleMenu>
          <BlockCommandMenu editor={editor} />
        </>
      ) : null}

      {/* ── 툴바 ──────────────────────────────────── */}
      <fieldset
        disabled={disabled}
        role="toolbar"
        aria-label="편집 도구"
        className={
          isPage
            ? "sticky top-[var(--app-topbar-height)] z-10 flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-lg border border-border bg-background/95 px-1.5 py-1 backdrop-blur-sm disabled:opacity-60"
            : "flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border bg-muted/40 px-2 py-2 disabled:opacity-60 sm:px-3"
        }
      >
        {/* 실행 취소 / 다시 실행 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!toolbarState?.canUndo}
          title="실행 취소 (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!toolbarState?.canRedo}
          title="다시 실행 (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 헤딩 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setParagraph().run()}
          active={toolbarState?.paragraph}
          title="본문"
        >
          <span className="text-xs font-medium w-4 text-center">P</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={toolbarState?.heading1}
          title="제목 1 (H1)"
        >
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={toolbarState?.heading2}
          title="제목 2 (H2)"
        >
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={toolbarState?.heading3}
          title="제목 3 (H3)"
        >
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 인라인 서식 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={toolbarState?.bold}
          title="굵게 (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={toolbarState?.italic}
          title="기울임 (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={toolbarState?.underline}
          title="밑줄 (Ctrl+U)"
        >
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={toolbarState?.strike}
          title="취소선"
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={toolbarState?.highlight}
          title="형광펜"
        >
          <Highlighter className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 정렬 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={toolbarState?.textAlignLeft}
          title="왼쪽 정렬"
        >
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={toolbarState?.textAlignCenter}
          title="가운데 정렬"
        >
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={toolbarState?.textAlignRight}
          title="오른쪽 정렬"
        >
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 리스트 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={toolbarState?.bulletList}
          title="글머리 기호 목록"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={toolbarState?.orderedList}
          title="번호 매기기 목록"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={toolbarState?.taskList}
          title="체크리스트"
        >
          <ListTodo className="w-4 h-4" />
        </ToolbarButton>

        <Divider />

        {/* 블록 요소 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={toolbarState?.blockquote}
          title="인용구"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={toolbarState?.codeBlock}
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
          onClick={() => openInsertPanel("link")}
          active={toolbarState?.link}
          title="링크 삽입"
        >
          <LinkIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => imageInputRef.current?.click()}
          title="이미지 올리기 (붙여넣기·끌어 놓기도 가능)"
        >
          <ImagePlus className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => openInsertPanel("image")}
          title="이미지 주소로 넣기"
        >
          <ImageIcon className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => openInsertPanel("youtube")}
          title="유튜브 동영상 삽입"
        >
          <Video className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={addTable}
          active={toolbarState?.table}
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
      </fieldset>

      <input
        ref={imageInputRef}
        type="file"
        accept={EDITOR_IMAGE_ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          uploadImages(files);
        }}
      />

      {insertPanel ? (
        <EditorInsertPanel
          key={`${insertPanel.kind}:${insertPanel.selection.from}:${insertPanel.selection.to}`}
          editor={editor}
          kind={insertPanel.kind}
          selection={insertPanel.selection}
          disabled={disabled}
          onClose={() => setInsertPanel(null)}
        />
      ) : null}

      {/* ── 에디터 / 마크다운 영역 ─────────────────── */}
      {isMarkdownMode ? (
        <textarea
          value={markdownText}
          onChange={handleMarkdownChange}
          disabled={disabled}
          aria-label={`${ariaLabel} 마크다운`}
          className={`${isPage ? "py-5" : "p-6"} flex-1 w-full font-mono text-sm text-foreground bg-background resize-none focus:outline-none leading-relaxed`}
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
      <div
        className={
          isPage
            ? "flex min-h-9 items-center justify-between gap-3 border-t border-border py-2"
            : "flex min-h-9 items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2"
        }
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {footer}
          <span role="status" aria-live="polite" className="text-xs">
            {imageUpload.pendingCount > 0 ? (
              <span className="text-muted-foreground">
                이미지 {imageUpload.pendingCount}장 올리는 중…
              </span>
            ) : imageUpload.error ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                {imageUpload.error}
                <button
                  type="button"
                  onClick={imageUpload.clearError}
                  className="rounded px-1 text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  닫기
                </button>
              </span>
            ) : null}
          </span>
        </div>
        {!disabled ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            <kbd className="font-sans">/</kbd> 블록
            {saveShortcutLabel ? (
              <>
                <span aria-hidden="true"> · </span>
                <kbd className="font-sans">⌘/Ctrl S</kbd> {saveShortcutLabel}
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
