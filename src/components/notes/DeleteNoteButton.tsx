"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Trash2 } from "lucide-react";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { trashPrivateNote } from "@/lib/actions/privateNotes";
import { createCreationOperationId } from "@/lib/creation-operation";
import { cn } from "@/lib/utils";

const MENU_ITEM_CLASS =
  "flex h-9 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-ui outline-none data-[highlighted]:bg-muted";

/** 휴지통 이동 요청. 응답을 잃은 재시도는 같은 operation ID를, 새 version은 새 ID를 쓴다. */
function useTrashNote(noteId: string, version: number) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const requestKey = JSON.stringify([noteId, version]);
  const operation = useRef<{ key: string; id: string } | null>(null);

  const trash = () => {
    if (isPending) return;
    if (operation.current?.key !== requestKey) {
      operation.current = { key: requestKey, id: createCreationOperationId() };
    }
    const operationId = operation.current.id;
    setError(null);
    startTransition(async () => {
      try {
        const result = await trashPrivateNote(noteId, operationId, version);
        if (!result.success) {
          setError(result.error ?? "노트를 휴지통으로 이동하지 못했습니다.");
          return;
        }
        setError(null);
        router.refresh();
      } catch {
        setError("노트를 휴지통으로 이동한 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return { isPending, error, clearError: () => setError(null), trash };
}

const CONFIRM_MESSAGE = "이 노트를 휴지통으로 이동할까요? 30일 동안 복원할 수 있습니다.";

/**
 * 노트 휴지통 이동(취소 우선 2단계 확인).
 * - `icon`(기본): 휴지통 아이콘 버튼 아래에 확인 영역을 연다.
 * - `menu`: 문서 위쪽 막대의 "더 보기" 메뉴(NoteDoc 보드 …). 메뉴의 focus scope가 끝난 뒤 trigger 아래에 확인을 띄운다.
 */
export function DeleteNoteButton({
  noteId,
  version,
  presentation = "icon",
  size = "md",
}: {
  noteId: string;
  version: number;
  presentation?: "icon" | "menu";
  /** menu: 넓은 화면 32×32, 좁은 화면 위쪽 막대 44×44. */
  size?: "md" | "touch";
}) {
  const { isPending, error, clearError, trash } = useTrashNote(noteId, version);
  const trashConfirm = useConfirmAction();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chosenRef = useRef(false);

  if (presentation === "menu") {
    return (
      <div className="relative">
        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              ref={triggerRef}
              type="button"
              aria-label="더 보기"
              disabled={isPending}
              className={cn(
                "flex shrink-0 items-center justify-center text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground",
                size === "touch" ? "size-11 rounded-touch" : "size-8 rounded-md",
              )}
            >
              <Ellipsis className={size === "touch" ? "size-[18px]" : "size-4"} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              collisionPadding={12}
              onCloseAutoFocus={(event) => {
                if (!chosenRef.current) return;
                chosenRef.current = false;
                event.preventDefault();
                triggerRef.current?.focus({ preventScroll: true });
                clearError();
                trashConfirm.request(triggerRef.current);
              }}
              style={{ zIndex: "var(--z-dropdown)" }}
              className="portal-menu w-56 rounded-lg border border-border bg-background p-1 shadow-floating"
            >
              <DropdownMenu.Item
                className={cn(MENU_ITEM_CLASS, "text-destructive")}
                onSelect={() => {
                  chosenRef.current = true;
                  setMenuOpen(false);
                }}
              >
                <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
                휴지통으로 이동
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {trashConfirm.isOpen ? (
          <div className="absolute right-0 top-full z-[var(--z-dropdown)] mt-2 w-72 max-w-[calc(100vw-2.5rem)] rounded-lg bg-background shadow-floating">
            <ConfirmPanel
              confirm={trashConfirm}
              message={CONFIRM_MESSAGE}
              confirmLabel="휴지통 이동 확인"
              pendingLabel="이동 중..."
              pending={isPending}
              onConfirm={trash}
              className="text-left"
            />
          </div>
        ) : error ? (
          <div
            role="alert"
            className="absolute right-0 top-full z-[var(--z-dropdown)] mt-2 flex w-72 max-w-[calc(100vw-2.5rem)] flex-col items-start gap-2 rounded-lg border border-destructive-border bg-destructive-muted p-3 text-xs text-destructive shadow-floating"
          >
            {error}
            <button
              type="button"
              onClick={clearError}
              className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              닫기
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={(event) => trashConfirm.request(event.currentTarget)}
        disabled={isPending}
        aria-expanded={trashConfirm.isOpen}
        className="flex size-8 items-center justify-center rounded-md text-secondary-foreground transition-colors hover:bg-destructive-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        title="휴지통으로 이동"
        aria-label="노트를 휴지통으로 이동"
      >
        <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
      </button>
      {trashConfirm.isOpen ? (
        <ConfirmPanel
          confirm={trashConfirm}
          message={CONFIRM_MESSAGE}
          confirmLabel="휴지통 이동 확인"
          pendingLabel="이동 중..."
          pending={isPending}
          onConfirm={trash}
          className="w-72 max-w-full text-left"
        />
      ) : null}
      {error ? (
        <span role="alert" className="max-w-64 text-right text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
