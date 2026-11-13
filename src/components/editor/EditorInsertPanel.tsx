"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type EditorInsertKind = "link" | "image" | "youtube";

export type EditorSelection = {
  from: number;
  to: number;
};

const PANEL_COPY: Record<EditorInsertKind, { label: string; placeholder: string }> = {
  link: { label: "링크 주소", placeholder: "https://example.com" },
  image: { label: "이미지 주소", placeholder: "https://example.com/image.jpg" },
  youtube: { label: "YouTube 주소", placeholder: "https://www.youtube.com/watch?v=…" },
};

export function normalizeEditorUrl(value: string, kind: EditorInsertKind): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    const allowed = kind === "link" ? ["http:", "https:", "mailto:", "tel:"] : ["http:", "https:"];
    return allowed.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 선택이 비어 있으면 표시 글자를 링크로 넣고, 선택이 있으면 그 범위에 링크를 건다.
 * 표시 글자는 text node로 넣는다. 문자열로 넣으면 tiptap-markdown이 markdown으로 다시 읽어
 * 글자 수가 달라지고, 원문 길이로 잡은 링크 범위가 뒤 본문까지 번진다.
 */
export function insertEditorLink(editor: Editor, selection: EditorSelection, text: string, href: string): void {
  const chain = editor.chain().focus().setTextSelection(selection);
  if (selection.from === selection.to) {
    const label = text.trim() || href;
    chain.insertContent({ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
  } else {
    chain.setLink({ href }).run();
  }
}

export function EditorInsertPanel({
  editor,
  kind,
  selection,
  disabled = false,
  onClose,
  className,
}: {
  editor: Editor;
  kind: EditorInsertKind;
  selection: EditorSelection;
  disabled?: boolean;
  onClose: () => void;
  /** 놓일 자리(상자 편집기의 도구 줄 아래, 문서 페이지의 떠 있는 패널)에 맞춘 틀. */
  className?: string;
}) {
  const selectedText = editor.state.doc.textBetween(selection.from, selection.to, " ");
  const currentHref = kind === "link" ? String(editor.getAttributes("link").href ?? "") : "";
  const [url, setUrl] = useState(currentHref);
  const [text, setText] = useState(selectedText);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const handleInsert = () => {
    if (disabled) return;
    const normalizedUrl = normalizeEditorUrl(url, kind);
    if (!normalizedUrl) {
      setError("사용할 수 있는 주소를 입력해 주세요.");
      return;
    }

    if (kind === "image") {
      editor
        .chain()
        .focus()
        .setTextSelection(selection)
        .setImage({ src: normalizedUrl, alt: text.trim() || undefined })
        .run();
      onClose();
      return;
    }

    if (kind === "youtube") {
      editor.chain().focus().setTextSelection(selection).setYoutubeVideo({ src: normalizedUrl }).run();
      onClose();
      return;
    }

    insertEditorLink(editor, selection, text, normalizedUrl);
    onClose();
  };

  const copy = PANEL_COPY[kind];

  return (
    <div
      data-editor-insert-panel
      role="group"
      className={cn("border-b border-muted bg-background px-3 py-3", className)}
      aria-label={`${copy.label} 입력`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          editor.commands.focus();
          return;
        }
        if (
          event.key !== "Enter" ||
          !(event.target instanceof HTMLInputElement) ||
          event.nativeEvent.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) return;
        event.preventDefault();
        event.stopPropagation();
        handleInsert();
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {(kind === "link" && selection.from === selection.to) || kind === "image" ? (
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-secondary-foreground">
              {kind === "image" ? "대체 텍스트" : "표시할 텍스트"}
            </span>
            <Input
              disabled={disabled}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={kind === "image" ? "이미지 내용을 설명하세요" : "링크 텍스트"}
            />
          </label>
        ) : null}
        <label className="flex min-w-0 flex-[2] flex-col gap-1.5">
          <span className="text-xs font-medium text-secondary-foreground">{copy.label}</span>
          <Input
            ref={inputRef}
            disabled={disabled}
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder={copy.placeholder}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        <div className="flex gap-2 md:pb-0.5">
          <Button type="button" variant="outline" disabled={disabled} onClick={onClose}>취소</Button>
          <Button type="button" disabled={disabled} onClick={handleInsert}>삽입</Button>
        </div>
      </div>
      {error ? <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
