"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  filterEditorBlockCommands,
  findSlashCommandMatch,
  type EditorBlockCommandContext,
  type SlashCommandMatch,
} from "./editor-block-commands";

type CommandMenuState = SlashCommandMatch & {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  activeIndex: number;
};

/**
 * `/` 검색과 키보드로 실행하는 블록 삽입 목록. `context`를 주면 이미지·동영상·링크처럼
 * 편집기 밖 패널을 여는 명령도 보인다(고정 도구 줄이 없는 문서 페이지).
 */
export function BlockCommandMenu({ editor, context }: { editor: Editor; context?: EditorBlockCommandContext }) {
  const menuId = useId();
  const [menu, setMenu] = useState<CommandMenuState | null>(null);
  const menuRef = useRef<CommandMenuState | null>(null);
  const dismissedMatchRef = useRef<SlashCommandMatch | null>(null);

  const hasContext = Boolean(context);
  const commands = useMemo(
    () => filterEditorBlockCommands(menu?.query ?? "", { withContext: hasContext }),
    [hasContext, menu?.query],
  );
  const contextRef = useRef(context);
  const commandsRef = useRef(commands);
  // 키보드·스크롤 핸들러가 읽는 최신 메뉴를 커밋 직후, 다음 입력 전에 반영한다.
  useLayoutEffect(() => {
    menuRef.current = menu;
    commandsRef.current = commands;
    contextRef.current = context;
  }, [menu, commands, context]);

  const close = useCallback(() => setMenu(null), []);

  const syncMenu = useCallback(() => {
    if (!editor.isFocused) {
      close();
      return;
    }
    const match = findSlashCommandMatch(editor);
    if (!match) {
      dismissedMatchRef.current = null;
      close();
      return;
    }
    const dismissed = dismissedMatchRef.current;
    if (dismissed?.from === match.from && dismissed.to === match.to && dismissed.query === match.query) {
      close();
      return;
    }
    dismissedMatchRef.current = null;

    const coords = editor.view.coordsAtPos(match.to);
    const owner = editor.view.dom.closest<HTMLElement>('[role="dialog"]');
    const bounds = owner?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = Math.max(bounds?.left ?? 0, viewport?.offsetLeft ?? 0) + 12;
    const topEdge = Math.max(bounds?.top ?? 0, viewport?.offsetTop ?? 0) + 12;
    const rightEdge = Math.min(bounds?.right ?? window.innerWidth, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)) - 12;
    const bottomEdge = Math.min(bounds?.bottom ?? window.innerHeight, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 12;
    const width = Math.min(304, rightEdge - leftEdge);
    const maxHeight = Math.min(360, bottomEdge - topEdge);
    if (width <= 0 || maxHeight < 80) {
      close();
      return;
    }
    const left = Math.max(leftEdge, Math.min(coords.left, rightEdge - width));
    const top = Math.max(topEdge, Math.min(coords.bottom + 8, bottomEdge - maxHeight));

    setMenu((current) => ({
      ...match,
      left: left - (bounds?.left ?? 0) - (owner?.clientLeft ?? 0) + (owner?.scrollLeft ?? 0),
      top: top - (bounds?.top ?? 0) - (owner?.clientTop ?? 0) + (owner?.scrollTop ?? 0),
      width,
      maxHeight,
      activeIndex: current?.query === match.query ? current.activeIndex : 0,
    }));
  }, [close, editor]);

  const execute = useCallback(
    (index: number) => {
      const current = menuRef.current;
      const command = commandsRef.current[index];
      if (!current || !command) return;

      editor.chain().focus().deleteRange({ from: current.from, to: current.to }).run();
      command.run(editor, contextRef.current);
      close();
    },
    [close, editor],
  );

  useEffect(() => {
    const handleTransaction = () => syncMenu();
    let blurTimer: number | undefined;
    const handleBlur = () => { blurTimer = window.setTimeout(close, 120); };
    const handleFocus = () => {
      window.clearTimeout(blurTimer);
      syncMenu();
    };
    const handleScroll = () => {
      if (menuRef.current) syncMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = menuRef.current;
      if (!current || !(event.target instanceof Node) || !editor.view.dom.contains(event.target)) return;

      const availableCommands = commandsRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissedMatchRef.current = current;
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (availableCommands.length === 0) return;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setMenu((value) =>
          value
            ? {
                ...value,
                activeIndex:
                  (value.activeIndex + delta + availableCommands.length) %
                  availableCommands.length,
              }
            : null,
        );
        return;
      }
      if (event.key === "Enter" && availableCommands.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        execute(current.activeIndex);
      }
      if (event.key === "Tab") {
        dismissedMatchRef.current = current;
        close();
      }
    };

    editor.on("transaction", handleTransaction);
    editor.on("blur", handleBlur);
    editor.on("focus", handleFocus);
    // 구독 직전에 이미 있던 편집기 포커스·슬래시 입력·DOM 위치(외부 상태)를 한 번 읽어 맞춘다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 이후 갱신은 위 편집기 이벤트 콜백이 맡는 외부 구독의 초기 동기화다.
    syncMenu();
    // Window capture precedes the parent dialog's document-level Escape handler.
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    window.visualViewport?.addEventListener("resize", handleScroll);
    window.visualViewport?.addEventListener("scroll", handleScroll);

    return () => {
      editor.off("transaction", handleTransaction);
      editor.off("blur", handleBlur);
      editor.off("focus", handleFocus);
      window.clearTimeout(blurTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
      window.visualViewport?.removeEventListener("resize", handleScroll);
      window.visualViewport?.removeEventListener("scroll", handleScroll);
    };
  }, [close, editor, execute, syncMenu]);

  useEffect(() => {
    if (!menu) return;
    const input = editor.view.dom;
    const previousControls = input.getAttribute("aria-controls");
    const previousActive = input.getAttribute("aria-activedescendant");
    input.setAttribute("aria-controls", menuId);
    if (commands[menu.activeIndex]) input.setAttribute("aria-activedescendant", `${menuId}-${menu.activeIndex}`);
    return () => {
      if (previousControls === null) input.removeAttribute("aria-controls");
      else input.setAttribute("aria-controls", previousControls);
      if (previousActive === null) input.removeAttribute("aria-activedescendant");
      else input.setAttribute("aria-activedescendant", previousActive);
    };
  }, [commands, editor, menu, menuId]);

  if (!menu || typeof document === "undefined") return null;
  const portalOwner = editor.view.dom.closest<HTMLElement>('[role="dialog"]');

  return createPortal(
    <div
      id={menuId}
      role="listbox"
      aria-label="블록 삽입"
      className="z-[var(--z-dropdown)] flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-floating"
      style={{ position: portalOwner ? "absolute" : "fixed", left: menu.left, top: menu.top, width: menu.width, maxHeight: menu.maxHeight }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="shrink-0 border-b border-muted px-3 py-2">
        <p className="text-[11px] font-semibold text-secondary-foreground">블록 삽입</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {menu.query ? `“${menu.query}” 검색 결과` : "입력하거나 ↑↓ 키로 선택하세요"}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto p-1">
        {commands.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            일치하는 블록이 없습니다.
          </p>
        ) : (
          commands.map(({ id, label, description, Icon }, index) => {
            const active = index === menu.activeIndex;
            return (
              <button
                id={`${menuId}-${index}`}
                key={id}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={active}
                onMouseEnter={() => setMenu((value) => (value ? { ...value, activeIndex: index } : null))}
                onClick={() => execute(index)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-foreground ${
                  active ? "bg-muted" : ""
                }`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-secondary-foreground">
                  <Icon className="size-4" strokeWidth={1.6} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-ui font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{description}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>,
    portalOwner ?? document.body,
  );
}
