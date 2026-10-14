"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
  filterEditorBlockCommands,
  findSlashCommandMatch,
  type SlashCommandMatch,
} from "./editor-block-commands";

type CommandMenuState = SlashCommandMatch & {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  activeIndex: number;
};

export function BlockCommandMenu({ editor }: { editor: Editor }) {
  const menuId = useId();
  const [menu, setMenu] = useState<CommandMenuState | null>(null);
  const menuRef = useRef<CommandMenuState | null>(null);
  const dismissedMatchRef = useRef<SlashCommandMatch | null>(null);
  menuRef.current = menu;

  const commands = useMemo(
    () => filterEditorBlockCommands(menu?.query ?? ""),
    [menu?.query],
  );
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

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
      command.run(editor);
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
      className="z-[var(--z-dropdown)] flex flex-col overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-floating"
      style={{ position: portalOwner ? "absolute" : "fixed", left: menu.left, top: menu.top, width: menu.width, maxHeight: menu.maxHeight }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="shrink-0 border-b border-border px-3 py-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">블록 삽입</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {menu.query ? `“${menu.query}” 검색 결과` : "입력하거나 ↑↓ 키로 선택하세요"}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto p-1.5">
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
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
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
