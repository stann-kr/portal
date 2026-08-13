/**
 * @file src/components/student-portal/CreateEntryDropdown.tsx
 * @description 콘텐츠 추가 드롭다운 메뉴.
 * 노트/QnA → 풀 페이지로 이동. 일정/디깅 → 기존 다이얼로그 열기.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, CalendarPlus, FileText, Music, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventFormDialog } from "@/components/calendar/EventFormDialog";
import { AddTrackDialog } from "@/components/digging/AddTrackDialog";
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
}

// ── 메뉴 항목 정의 ────────────────────────────────

const MENU_ITEMS = [
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
}: CreateEntryDropdownProps) {
  const router = useRouter();
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [diggingDialogOpen, setDiggingDialogOpen] = useState(false);
  const [internalDropdownOpen, setInternalDropdownOpen] = useState(false);
  const dropdownOpen = open ?? internalDropdownOpen;
  const setDropdownOpen = onOpenChange ?? setInternalDropdownOpen;

  const handleSelect = (id: (typeof MENU_ITEMS)[number]["id"]) => {
    setDropdownOpen(false);
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
    }
  };

  return (
    <>
      <DropdownMenu.Root open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 text-xs ml-2 flex-shrink-0"
            aria-label="새 항목 추가"
          >
            <Plus className="w-3.5 h-3.5" />
            추가
          </Button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[200px] bg-background border border-border rounded-xl shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95"
          >
            {MENU_ITEMS.filter(({ id }) => {
              if (id === "note") return Boolean(noteCreateHref);
              if (id === "qna") return canCreateQna;
              if (id === "event") return canCreateEvent;
              if (id === "digging") return canCreateDigging;
              return true;
            }).map(({ id, label, description, Icon }) => (
              <DropdownMenu.Item
                key={id}
                onSelect={() => handleSelect(id)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-accent outline-none transition-colors"
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* 일정 다이얼로그 */}
      <EventFormDialog
        open={eventDialogOpen}
        onOpenChange={setEventDialogOpen}
        defaultStart={defaultDate}
        studentId={studentId}
        spaceLabel={spaceLabel}
        onSuccess={onSuccess}
      />

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
