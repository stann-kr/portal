"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  activeIndex: number;
};

export function BlockCommandMenu({ editor }: { editor: Editor }) {
  const [menu, setMenu] = useState<CommandMenuState | null>(null);
  const menuRef = useRef<CommandMenuState | null>(null);
  menuRef.current = menu;

  const commands = useMemo(
    () => filterEditorBlockCommands(menu?.query ?? ""),
    [menu?.query],
  );
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  const close = useCallback(() => setMenu(null), []);

  const syncMenu = useCallback(() => {
    const match = findSlashCommandMatch(editor);
    if (!match) {
      close();
      return;
    }

    const coords = editor.view.coordsAtPos(match.to);
    const menuWidth = 304;
    const left = Math.max(12, Math.min(coords.left, window.innerWidth - menuWidth - 12));
    const top = Math.min(coords.bottom + 8, window.innerHeight - 360);

    setMenu((current) => ({
      ...match,
      left,
      top: Math.max(12, top),
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
    const handleBlur = () => window.setTimeout(() => close(), 120);
    const handleScroll = () => {
      if (menuRef.current) syncMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = menuRef.current;
      if (!current) return;

      const availableCommands = commandsRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
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
        execute(current.activeIndex);
      }
    };

    editor.on("transaction", handleTransaction);
    editor.on("blur", handleBlur);
    editor.view.dom.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      editor.off("transaction", handleTransaction);
      editor.off("blur", handleBlur);
      editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [close, editor, execute, syncMenu]);

  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="listbox"
      aria-label="블록 삽입"
      className="fixed z-[var(--z-dropdown)] w-[19rem] overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-floating"
      style={{ left: menu.left, top: menu.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="border-b border-border px-3 py-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">블록 삽입</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {menu.query ? `“${menu.query}” 검색 결과` : "입력하거나 ↑↓ 키로 선택하세요"}
        </p>
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {commands.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            일치하는 블록이 없습니다.
          </p>
        ) : (
          commands.map(({ id, label, description, Icon }, index) => {
            const active = index === menu.activeIndex;
            return (
              <button
                key={id}
                type="button"
                role="option"
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
    document.body,
  );
}
