/**
 * @file src/components/editor/FullEditor.tsx
 * @description 풀 사양 리치텍스트 에디터.
 * Tiptap v3 기반. 헤딩/리스트/코드블록/테이블/링크/이미지/유튜브/마크다운 지원.
 * WYSIWYG ↔ 마크다운 모드 토글 포함.
 * 고정 서식 줄은 `toolbar`(full·compact·none)로 줄이고, 줄이 없거나 줄어도 선택 서식 메뉴와 `/` 블록 메뉴는 그대로 쓴다.
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
import { createPortal } from "react-dom";
import {
  Underline as UnderlineIcon, Strikethrough, Highlighter,
  Heading1, Heading2, Heading3, List, ListOrdered, ListTodo,
  Quote, Code2, Link as LinkIcon, Image as ImageIcon, ImagePlus, Video,
  Table as TableIcon, AlignLeft, AlignCenter, AlignRight,
  Minus, Undo2, Redo2, FileText, Eye, Unlink, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BlockCommandMenu } from "./BlockCommandMenu";
import type { EditorBlockCommandContext } from "./editor-block-commands";
import {
  EditorInsertPanel,
  type EditorInsertKind,
  type EditorSelection,
} from "./EditorInsertPanel";
import { createDeferredDocumentSerializer } from "@/lib/deferred-document-serializer";
import {
  DOCUMENT_IMAGE_UPLOADER,
  EDITOR_IMAGE_ACCEPT,
  isEditorImageFile,
  pastedEditorImageFiles,
  useEditorImageUpload,
  type EditorImageUploader,
  type EditorUploadedImage,
} from "./useEditorImageUpload";
import { GuideBlockId } from "./guide-block-id-extension";
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
   * boxed: 테두리 상자 안의 편집기(Q&A·게시물 form). 위에 서식 도구 줄(`toolbar`), 아래에 상태 줄이 있다.
   * page: 노트 문서 본문(NoteDoc·MobileNoteDoc 보드). 테두리·고정 도구 줄 없이 선택 시 떠 있는 서식 메뉴와 `/` 블록 메뉴를 쓰고,
   * 좁은 화면에서는 본문을 편집하는 동안 아래쪽 서식 줄을 띄운다.
   * bare: 상위 화면이 상자와 바닥 줄을 그리는 입력란(QnaThread·MobileQnaThread 답글 상자). 테두리·고정 도구 줄·상태 줄 없이
   * 본문만 그리고, 이미지 업로드 상태와 마크다운 전환은 `toolsContainer`에 넣는다.
   */
  variant?: "boxed" | "page" | "bare";
  /**
   * boxed 편집기 위 고정 서식 줄. 선택 영역 서식 메뉴와 `/` 블록 메뉴는 어느 값이든 그대로 쓴다.
   * full(기본): 모든 서식 버튼. compact: 굵게·기울임·목록·이미지 네 칸(QnaNew 보드, 좁은 화면은 MobileQnaNew 보드대로 숨김).
   * none: 고정 줄 없음(CommunityNew 보드).
   */
  toolbar?: "full" | "compact" | "none";
  /** bare 본문의 글자·안쪽 여백 class(편집 영역과 마크다운 입력란에 함께 적용) */
  contentClassName?: string;
  /** bare 편집기의 이미지 업로드 상태와 마크다운 전환을 넣을 상위 화면 요소. 없으면 본문 아래 한 줄에 둔다. */
  toolsContainer?: HTMLElement | null;
  /** 본문 이미지가 올라가는 중이거나 넣기를 기다리는 동안 true. 상위 form은 제출·자동 저장을 미룬다. */
  onUploadingChange?: (uploading: boolean) => void;
  /** 본문 이미지를 올릴 곳. 없으면 학생 문서 이미지(media) 흐름을 쓴다. 공용 가이드는 가이드 이미지 저장소를 넘긴다. */
  imageUploader?: EditorImageUploader;
  /** 가이드 편집: 블록의 data-block-id(질문 위치)를 보존한다. 노트·게시물은 쓰지 않는다. */
  preserveBlockIds?: boolean;
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

const ICON = "size-4";

/** 상자 편집기 위 서식 줄(QnaNew 보드): 30px 칸, 글자 2, 켜진 서식은 선택 채움. */
function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  label = title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** 마우스를 올렸을 때 보이는 설명(단축키 포함) */
  title: string;
  /** 접근 가능한 이름. 없으면 title을 쓴다. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-[30px] shrink-0 items-center justify-center rounded-md text-ui transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        active ? "bg-selected text-foreground" : "text-secondary-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

/** 선택 영역 위에 떠 있는 서식 메뉴(NoteDoc 보드): 먹색 면, 28px 칸. 누르는 동안 본문 선택을 유지한다. */
function BubbleButton({
  onClick,
  active,
  label,
  children,
  className,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-sm text-ui text-primary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        active && "bg-primary-foreground/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** 좁은 화면 아래쪽 서식 줄(MobileNoteDoc 보드): 44px 칸. 누르는 동안 본문 초점을 유지한다. */
function MobileToolbarButton({
  onClick,
  active,
  label,
  children,
  className,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-touch text-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

const SLASH_HINT = "'/'를 눌러 블록 추가";

function readSaveShortcutKey(): string {
  if (typeof navigator === "undefined") return "Ctrl+S";
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform || navigator.userAgent) ? "⌘S" : "Ctrl+S";
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function FullEditor({
  initialContent = "",
  onChange,
  onDirty,
  contentVersion = 0,
  placeholder = "내용을 입력하세요... (/ 로 블록 삽입)",
  minHeight: minHeightProp,
  disabled = false,
  ariaLabel = "문서 내용",
  footer,
  saveShortcutLabel,
  variant = "boxed",
  toolbar = "full",
  contentClassName,
  toolsContainer,
  onUploadingChange,
  imageUploader = DOCUMENT_IMAGE_UPLOADER,
  preserveBlockIds = false,
}: FullEditorProps) {
  const isPage = variant === "page";
  const isBare = variant === "bare";
  // 고정 서식 줄은 상자 편집기만 가진다. 문서 페이지와 bare 입력란은 선택 메뉴·`/` 메뉴로 서식을 고른다.
  const fixedToolbar = variant === "boxed" ? toolbar : "none";
  // bare 입력란의 높이는 상위 화면이 class로 정한다(좁은 화면 44px·넓은 화면 96px처럼 반응형).
  const minHeight = minHeightProp ?? (isBare ? undefined : "calc(100vh - 320px)");
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

  const imageUploaderRef = useRef(imageUploader);
  useEffect(() => {
    imageUploaderRef.current = imageUploader;
  }, [imageUploader]);
  const discardDeferredImages = useCallback(() => {
    for (const upload of deferredImagesRef.current) imageUploaderRef.current.abandon(upload.mediaObjectId);
    deferredImagesRef.current = [];
    setDeferredImageCount(0);
  }, []);

  const handleUploadedImage = useCallback(
    (upload: EditorUploadedImage, generation: number) => {
      if (generation !== contentGenerationRef.current || !editorInstanceRef.current) {
        imageUploaderRef.current.abandon(upload.mediaObjectId);
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
  const imageUpload = useEditorImageUpload<number>(handleUploadedImage, imageUploader);
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
      ...(preserveBlockIds ? [GuideBlockId] : []),
    ],
    [placeholder, preserveBlockIds],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        // 본문 글자: 문서 16/28, 상자 15/26(QnaNew 보드)·좁은 화면 16/26(MobileQnaNew 보드), bare는 상위 화면이 정한다(QnaThread 15/24).
        class: isPage
          ? "max-w-none text-base leading-7 text-foreground focus:outline-none"
          : isBare
            ? cn("max-w-none text-foreground focus:outline-none", contentClassName)
            : "max-w-none px-3.5 py-3 text-base leading-[26px] text-foreground focus:outline-none md:px-4 md:py-3.5 md:text-md",
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
    [ariaLabel, contentClassName, isBare, isPage, uploadImages],
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
      for (const upload of deferredImagesRef.current) imageUploaderRef.current.abandon(upload.mediaObjectId);
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

  const pickImages = useCallback(() => {
    if (disabled) return;
    imageInputRef.current?.click();
  }, [disabled]);
  // 고정 도구 줄이 없는 문서 페이지는 이미지·동영상·링크를 `/` 메뉴에서 연다.
  const commandContext = useMemo<EditorBlockCommandContext>(
    () => ({ pickImages, openInsertPanel }),
    [openInsertPanel, pickImages],
  );

  if (!editor) return null;

  const saveShortcutKey = readSaveShortcutKey();
  const isCompactToolbar = fixedToolbar === "compact";
  const markdownToggleLabel = isMarkdownMode ? "미리보기" : "마크다운";
  const MarkdownToggleIcon = isMarkdownMode ? Eye : FileText;

  // 알림 자리는 늘 두되(나중에 넣은 글이 읽히도록), 비어 있으면 화면에서 빼 도구 줄에 빈 간격을 만들지 않는다.
  const imageStatus = (
    <span role="status" aria-live="polite" className="text-xs empty:sr-only">
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
            className="rounded-sm px-1 text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            닫기
          </button>
        </span>
      ) : null}
    </span>
  );

  const shortcutHint = !disabled && saveShortcutLabel ? (
    <span className="shrink-0 font-mono text-xs text-muted-foreground">
      {saveShortcutLabel} <kbd className="font-mono">{saveShortcutKey}</kbd>
    </span>
  ) : null;

  // 전체 서식 줄이 없는 편집기는 마크다운 전환을 상태 줄(bare는 상위 화면의 도구 자리)에 둔다.
  // 가이드 편집(preserveBlockIds)은 마크다운으로 오가면 블록 식별자(질문 위치)가 사라지므로 전환을 두지 않는다.
  const markdownToggle = !disabled && !preserveBlockIds ? (
    <button
      type="button"
      onClick={handleMarkdownToggle}
      title="마크다운 / WYSIWYG 전환"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MarkdownToggleIcon className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
      {markdownToggleLabel}
    </button>
  ) : null;

  const bareTools = isBare ? (
    <>
      {footer}
      {imageStatus}
      {markdownToggle}
      {shortcutHint}
    </>
  ) : null;

  return (
    <div
      className={
        isPage
          ? "group/editor relative flex flex-col bg-background"
          : isBare
            ? "relative flex min-h-0 min-w-0 flex-1 flex-col"
            : "relative flex flex-col overflow-hidden rounded-lg border border-border bg-background transition-[border-color,box-shadow] duration-[var(--duration-fast)] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring motion-reduce:transition-none"
      }
    >

      {!isMarkdownMode && !disabled ? (
        <>
          <BubbleMenu
            editor={editor}
            pluginKey="editor-inline-format-menu"
            updateDelay={80}
            options={{ placement: "top", offset: 8 }}
            className="flex items-center gap-0.5 rounded-touch bg-primary p-1 shadow-floating"
          >
            <BubbleButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={toolbarState?.bold}
              label="굵게"
              className="font-semibold"
            >
              B
            </BubbleButton>
            <BubbleButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={toolbarState?.italic}
              label="기울임"
              className="italic"
            >
              I
            </BubbleButton>
            <BubbleButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              active={toolbarState?.underline}
              label="밑줄"
              className="underline underline-offset-2"
            >
              U
            </BubbleButton>
            <BubbleButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              active={toolbarState?.strike}
              label="취소선"
              className="line-through"
            >
              S
            </BubbleButton>
            <BubbleButton
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              active={toolbarState?.highlight}
              label="형광펜"
            >
              H
            </BubbleButton>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-primary-foreground/20" />
            <BubbleButton
              onClick={() => openInsertPanel("link")}
              active={toolbarState?.link}
              label="링크"
            >
              <LinkIcon className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            </BubbleButton>
            {toolbarState?.link ? (
              <BubbleButton
                onClick={() => editor.chain().focus().unsetLink().run()}
                label="링크 제거"
              >
                <Unlink className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              </BubbleButton>
            ) : null}
          </BubbleMenu>
          <BlockCommandMenu editor={editor} context={commandContext} />
        </>
      ) : null}

      {/* ── 상자 편집기 서식 줄: full은 전체, compact는 QnaNew 보드의 네 칸 ── */}
      {fixedToolbar !== "none" ? (
        <fieldset
          disabled={disabled}
          role="toolbar"
          aria-label={isCompactToolbar ? "서식" : "편집 도구"}
          className={cn(
            "scroll-row flex h-10 min-w-0 shrink-0 flex-nowrap items-center gap-0.5 border-b border-muted px-1.5 disabled:opacity-60",
            // MobileQnaNew 보드는 고정 줄 없이 본문만 둔다. 서식은 선택 메뉴·`/` 메뉴로 고른다.
            isCompactToolbar && "hidden md:flex",
          )}
        >
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={toolbarState?.bold}
            title="굵게 (Ctrl+B)"
            label={isCompactToolbar ? "굵게" : undefined}
          >
            <span className="font-semibold">B</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={toolbarState?.italic}
            title="기울임 (Ctrl+I)"
            label={isCompactToolbar ? "기울임" : undefined}
          >
            <span className="italic">I</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={toolbarState?.bulletList}
            title="글머리 기호 목록"
            label={isCompactToolbar ? "목록" : undefined}
          >
            <List className={isCompactToolbar ? "size-3.5" : ICON} strokeWidth={1.6} aria-hidden="true" />
          </ToolbarButton>
          <ToolbarButton
            onClick={pickImages}
            title="이미지 올리기 (붙여넣기·끌어 놓기도 가능)"
            label={isCompactToolbar ? "이미지" : undefined}
          >
            {isCompactToolbar ? (
              <ImageIcon className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <ImagePlus className={ICON} strokeWidth={1.6} aria-hidden="true" />
            )}
          </ToolbarButton>

          {fixedToolbar === "full" ? (
            <>
              <Divider />

              <ToolbarButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                active={toolbarState?.underline}
                title="밑줄 (Ctrl+U)"
              >
                <UnderlineIcon className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                active={toolbarState?.strike}
                title="취소선"
              >
                <Strikethrough className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                active={toolbarState?.highlight}
                title="형광펜"
              >
                <Highlighter className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>

              <Divider />

              <ToolbarButton
                onClick={() => editor.chain().focus().setParagraph().run()}
                active={toolbarState?.paragraph}
                title="본문"
              >
                <span className="w-4 text-center text-xs font-medium">P</span>
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                active={toolbarState?.heading1}
                title="제목 1 (H1)"
              >
                <Heading1 className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                active={toolbarState?.heading2}
                title="제목 2 (H2)"
              >
                <Heading2 className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                active={toolbarState?.heading3}
                title="제목 3 (H3)"
              >
                <Heading3 className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>

              <Divider />

              <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                active={toolbarState?.orderedList}
                title="번호 매기기 목록"
              >
                <ListOrdered className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                active={toolbarState?.taskList}
                title="체크리스트"
              >
                <ListTodo className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                active={toolbarState?.blockquote}
                title="인용구"
              >
                <Quote className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                active={toolbarState?.codeBlock}
                title="코드 블록"
              >
                <Code2 className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                title="구분선"
              >
                <Minus className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>

              <Divider />

              <ToolbarButton
                onClick={() => openInsertPanel("link")}
                active={toolbarState?.link}
                title="링크 삽입"
              >
                <LinkIcon className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => openInsertPanel("image")}
                title="이미지 주소로 넣기"
              >
                <ImageIcon className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => openInsertPanel("youtube")}
                title="유튜브 동영상 삽입"
              >
                <Video className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={addTable}
                active={toolbarState?.table}
                title="표 삽입"
              >
                <TableIcon className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>

              <Divider />

              <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("left").run()}
                active={toolbarState?.textAlignLeft}
                title="왼쪽 정렬"
              >
                <AlignLeft className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("center").run()}
                active={toolbarState?.textAlignCenter}
                title="가운데 정렬"
              >
                <AlignCenter className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign("right").run()}
                active={toolbarState?.textAlignRight}
                title="오른쪽 정렬"
              >
                <AlignRight className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>

              <Divider />

              <ToolbarButton
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!toolbarState?.canUndo}
                title="실행 취소 (Ctrl+Z)"
              >
                <Undo2 className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!toolbarState?.canRedo}
                title="다시 실행 (Ctrl+Shift+Z)"
              >
                <Redo2 className={ICON} strokeWidth={1.6} aria-hidden="true" />
              </ToolbarButton>

              {/* 마크다운 모드 토글(가이드 편집은 블록 식별자를 지키려고 숨긴다) */}
              <div className={cn("ml-auto shrink-0 pl-1", preserveBlockIds && "hidden")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkdownToggle}
                  className={cn("gap-1.5", isMarkdownMode && "text-foreground")}
                  title="마크다운 / WYSIWYG 전환"
                >
                  <MarkdownToggleIcon className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                  {markdownToggleLabel}
                </Button>
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}

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
          // 문서 페이지는 도구 줄이 없으므로 스크롤해도 보이는 떠 있는 패널로 연다.
          // bare 입력란은 좁은 바닥 막대에도 놓이므로 입력란 위에 떠 있는 패널로 연다.
          className={
            isPage
              ? "sticky top-[var(--editor-sticky-top,var(--app-topbar-height))] z-20 mb-3 rounded-lg border border-border shadow-floating"
              : isBare
                ? "absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border border-border shadow-floating"
                : undefined
          }
        />
      ) : null}

      {/* ── 에디터 / 마크다운 영역 ─────────────────── */}
      {isMarkdownMode ? (
        <textarea
          value={markdownText}
          onChange={handleMarkdownChange}
          disabled={disabled}
          aria-label={`${ariaLabel} 마크다운`}
          className={cn(
            "w-full flex-1 resize-none bg-background font-mono text-sm leading-relaxed text-foreground focus:outline-none",
            isPage ? "py-1" : isBare ? contentClassName : "px-3.5 py-3 md:px-4 md:py-3.5",
          )}
          style={minHeight ? { minHeight } : undefined}
          placeholder="마크다운으로 작성하세요..."
        />
      ) : (
        <div
          className={cn("flex-1 cursor-text overflow-auto", isBare && "min-h-0")}
          style={minHeight ? { minHeight } : undefined}
          onClick={() => editor.commands.focus()}
        >
          <EditorContent editor={editor} />
        </div>
      )}

      {/* ── bare: 업로드 상태·마크다운 전환은 상위 화면이 정한 자리에 둔다 ── */}
      {bareTools ? (
        toolsContainer ? (
          createPortal(bareTools, toolsContainer)
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pb-2 text-xs text-muted-foreground">
            {bareTools}
          </div>
        )
      ) : null}

      {/* ── 상태 줄: 초안 상태·업로드·단축키 ───────────── */}
      {!isBare ? (
        <div
          className={
            isPage
              ? "mt-6 flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-muted pt-3 text-xs text-muted-foreground"
              : "flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-muted px-3 py-2 text-xs text-muted-foreground"
          }
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {footer}
            {imageStatus}
          </div>
          {fixedToolbar !== "full" ? (
            <div className="flex shrink-0 items-center gap-3">
              {markdownToggle}
              {shortcutHint}
            </div>
          ) : shortcutHint}
        </div>
      ) : null}

      {/* ── 좁은 화면 문서 편집 서식 줄: 본문(또는 이 줄)에 초점이 있는 동안만 보인다 ── */}
      {isPage && !isMarkdownMode ? (
        <fieldset
          disabled={disabled}
          role="toolbar"
          aria-label="서식"
          className="sticky bottom-0 z-10 -mx-[var(--editor-bleed,0px)] hidden items-center gap-0.5 border-t border-border bg-background px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 max-md:group-focus-within/editor:flex disabled:opacity-60"
        >
          <div className="scroll-row flex min-w-0 flex-1 items-center gap-0.5">
            <MobileToolbarButton
              label="블록 추가"
              onClick={() => {
                // `/` 메뉴는 줄 처음이나 공백 뒤에서만 열린다. 낱말 바로 뒤라면 공백을 함께 넣는다.
                const { $from } = editor.state.selection;
                const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "\ufffc");
                editor.chain().focus().insertContent(before && !/\s/u.test(before) ? " /" : "/").run();
              }}
            >
              <Plus className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </MobileToolbarButton>
            <MobileToolbarButton
              label="굵게"
              active={Boolean(toolbarState?.bold)}
              onClick={() => editor.chain().focus().toggleBold().run()}
              className="font-semibold"
            >
              B
            </MobileToolbarButton>
            <MobileToolbarButton
              label="기울임"
              active={Boolean(toolbarState?.italic)}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className="italic"
            >
              I
            </MobileToolbarButton>
            <MobileToolbarButton
              label="형광펜"
              active={Boolean(toolbarState?.highlight)}
              onClick={() => editor.chain().focus().toggleHighlight().run()}
            >
              H
            </MobileToolbarButton>
            <MobileToolbarButton
              label="할 일 목록"
              active={Boolean(toolbarState?.taskList)}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListTodo className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </MobileToolbarButton>
            <MobileToolbarButton
              label="링크"
              active={Boolean(toolbarState?.link)}
              onClick={() => openInsertPanel("link")}
            >
              <LinkIcon className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </MobileToolbarButton>
            <MobileToolbarButton
              label="밑줄"
              active={Boolean(toolbarState?.underline)}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className="underline underline-offset-2"
            >
              U
            </MobileToolbarButton>
            <MobileToolbarButton
              label="취소선"
              active={Boolean(toolbarState?.strike)}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className="line-through"
            >
              S
            </MobileToolbarButton>
            <MobileToolbarButton label="이미지 올리기" onClick={pickImages}>
              <ImagePlus className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </MobileToolbarButton>
            <MobileToolbarButton label="실행 취소" onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </MobileToolbarButton>
            <MobileToolbarButton label="다시 실행" onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </MobileToolbarButton>
          </div>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              editor.commands.blur();
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            className="h-11 shrink-0 rounded-touch px-3 text-md font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            완료
          </button>
        </fieldset>
      ) : null}
    </div>
  );
}
