/**
 * @file src/components/student-portal/CreateEntryDropdown.tsx
 * @description 화면 머리의 "새로 만들기"(캔버스 Calendar 보드의 먹색 주 버튼)와 그 메뉴.
 * 노트/QnA → 작성 화면, 일정/디깅/레슨 → 대화상자. 만들 수 있는 항목이 하나뿐이면(관리자 "레슨 예약")
 * 메뉴 없이 그 버튼 하나로 바로 연다.
 */
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, CalendarPlus, CalendarClock, FileText, Music, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventFormDialog } from "@/components/calendar/EventFormDialog";
import { AddTrackDialog } from "@/components/digging/AddTrackDialog";
import { LessonScheduleDialog } from "@/components/calendar/LessonScheduleDialog";
import type { DiggingColumnType } from "@/db/schema";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

// ── 타입 ──────────────────────────────────────────

type DiggingColumn = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  options: string | null | undefined;
};

interface CreateEntryDropdownProps {
  studentId: string;
  diggingColumns: DiggingColumn[];
  spaceLabel: string;
  defaultDate?: string;
  onSuccess?: (item: UnifiedItem) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 선택한 학생과 날짜 문맥을 포함한 full-page 노트 composer URL. */
  noteCreateHref?: string;
  onOpenQnaPanel?: () => void;
  /** 학생 전용 Q&A 생성 메뉴 노출 여부 */
  canCreateQna?: boolean;
  /** 현재 action이 선택 학생을 target으로 받지 못하는 일정 생성 노출 여부 */
  canCreateEvent?: boolean;
  /** 현재 action이 선택 학생을 target으로 받지 못하는 디깅 생성 노출 여부 */
  canCreateDigging?: boolean;
  /** 관리자가 선택한 학생의 레슨을 예약할 수 있는지 여부 */
  canCreateLesson?: boolean;
}

// ── 메뉴 항목 정의 ────────────────────────────────

const MENU_ITEMS = [
  {
    id: "lesson" as const,
    label: "레슨 예약",
    description: "학생 레슨 일정",
    Icon: CalendarClock,
  },
  {
    id: "event" as const,
    label: "일정 추가",
    description: "레슨, 연습, 공연 등",
    Icon: CalendarPlus,
  },
  {
    id: "note" as const,
    label: "노트 작성",
    description: "1:1 개인 메모",
    Icon: FileText,
  },
  {
    id: "digging" as const,
    label: "디깅 트랙",
    description: "참고 트랙 추가",
    Icon: Music,
  },
  {
    id: "qna" as const,
    label: "Q&A 질문",
    description: "강사에게 질문",
    Icon: HelpCircle,
  },
] as const;

type MenuItemId = (typeof MENU_ITEMS)[number]["id"];

// ── 컴포넌트 ─────────────────────────────────────

export function CreateEntryDropdown({
  studentId,
  diggingColumns,
  spaceLabel,
  defaultDate,
  onSuccess,
  open,
  onOpenChange,
  noteCreateHref,
  onOpenQnaPanel,
  canCreateQna = true,
  canCreateEvent = true,
  canCreateDigging = true,
  canCreateLesson = false,
}: CreateEntryDropdownProps) {
  const router = useRouter();
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [diggingDialogOpen, setDiggingDialogOpen] = useState(false);
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [internalDropdownOpen, setInternalDropdownOpen] = useState(false);
  const dropdownOpen = open ?? internalDropdownOpen;
  const setDropdownOpen = onOpenChange ?? setInternalDropdownOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingSelection = useRef<MenuItemId | null>(null);

  const available = MENU_ITEMS.filter(({ id }) => {
    if (id === "note") return Boolean(noteCreateHref);
    if (id === "qna") return canCreateQna;
    if (id === "event") return canCreateEvent;
    if (id === "digging") return canCreateDigging;
    if (id === "lesson") return canCreateLesson;
    return true;
  });

  const run = (id: MenuItemId) => {
    switch (id) {
      case "note":
        if (noteCreateHref) router.push(noteCreateHref);
        break;
      case "qna":
        if (onOpenQnaPanel) {
          onOpenQnaPanel();
        } else {
          router.push("/dashboard/qna/new");
        }
        break;
      case "event":
        setEventDialogOpen(true);
        break;
      case "digging":
        setDiggingDialogOpen(true);
        break;
      case "lesson":
        setLessonDialogOpen(true);
        break;
    }
  };

  const handleSelect = (id: MenuItemId) => {
    pendingSelection.current = id;
    setDropdownOpen(false);
  };

  const handleCloseAutoFocus = (event: Event) => {
    const id = pendingSelection.current;
    pendingSelection.current = null;
    if (!id) return;

    // Finish the menu's focus scope before opening the next dialog's scope.
    event.preventDefault();
    triggerRef.current?.focus({ preventScroll: true });
    run(id);
  };

  const single = available.length === 1 ? available[0] : null;

  return (
    <>
      {single ? (
        <Button ref={triggerRef} type="button" className="shrink-0" onClick={() => run(single.id)}>
          <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          {single.label}
        </Button>
      ) : available.length > 1 ? (
        <DropdownMenu.Root open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenu.Trigger asChild>
            <Button ref={triggerRef} type="button" className="shrink-0">
              <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              새로 만들기
            </Button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              onCloseAutoFocus={handleCloseAutoFocus}
              className="portal-menu z-50 w-60 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-floating"
            >
              {available.map(({ id, label, description, Icon }) => (
                <DropdownMenu.Item
                  key={id}
                  onSelect={() => handleSelect(id)}
                  className="flex min-h-11 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ui text-foreground">{label}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}

      {/* 일정 다이얼로그 */}
      <EventFormDialog
        open={eventDialogOpen}
        onOpenChange={setEventDialogOpen}
        defaultStart={defaultDate}
        studentId={studentId}
        spaceLabel={spaceLabel}
        onSuccess={onSuccess}
      />

      {canCreateLesson ? (
        <LessonScheduleDialog
          open={lessonDialogOpen}
          onOpenChange={setLessonDialogOpen}
          studentId={studentId}
          spaceLabel={spaceLabel}
          defaultStart={defaultDate}
          onSuccess={onSuccess}
        />
      ) : null}

      {/* 디깅 다이얼로그 */}
      <AddTrackDialog
        open={diggingDialogOpen}
        onOpenChange={setDiggingDialogOpen}
        columns={diggingColumns}
        studentId={studentId}
        spaceLabel={spaceLabel}
        onSuccess={onSuccess ?? (() => {})}
      />
    </>
  );
}
