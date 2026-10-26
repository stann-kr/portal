"use client";

import { useState } from "react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { UnifiedItemSpaceBadge, UnifiedItemTypeBadge } from "@/components/ui/unified-item-type";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";
import type { NoteDetailViewer } from "./UnifiedNoteDetail";

export type UnifiedItemChangeHandlers = {
  /** 학생 본인 스페이스에서만 포털 일정을 수정·삭제할 수 있다. */
  canManageEvents?: boolean;
  /** 관리자 일정에서 선택 학생의 레슨 시간을 바꾸거나 삭제할 수 있다. */
  canManageLessons?: boolean;
  onItemUpdated?: (item: UnifiedItem) => void;
  onItemRemoved?: (item: UnifiedItem) => void;
  /** 보는 사람. 노트 수정 권한(관리자 또는 작성자)이 있으면 패널 안에서 바로 고친다. */
  viewer?: NoteDetailViewer;
};

/**
 * 캘린더·일별·전체 보기가 같은 상세 패널과 변경 중 닫힘 잠금을 공유한다.
 * 머리 왼쪽은 유형 점·이름과 (관리자·외부 출처) 학생 칩, 노트는 전체 화면 열기를 닫기 옆에 둔다.
 */
export function UnifiedItemDetailPanel({
  item,
  open,
  onOpenChange,
  onItemChange,
  returnTo,
  showSpaceContext = false,
  canManageEvents = false,
  canManageLessons = false,
  onItemUpdated,
  onItemRemoved,
  viewer,
}: {
  item: UnifiedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 수정된 항목을 패널이 계속 보여 주도록 선택 상태를 갱신한다. */
  onItemChange: (item: UnifiedItem) => void;
  returnTo: string;
  /** 관리자 화면처럼 학생 스페이스를 함께 보여야 하면 true. */
  showSpaceContext?: boolean;
} & UnifiedItemChangeHandlers) {
  const [busy, setBusy] = useState(false);
  const isNote = item?.type === "NOTE";

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={isNote ? "노트" : item?.title}
      headerStart={item ? (
        <>
          <UnifiedItemTypeBadge item={item} />
          {showSpaceContext || item.source.kind !== "PORTAL" ? <UnifiedItemSpaceBadge item={item} /> : null}
        </>
      ) : undefined}
      size={isNote ? "note" : "md"}
      dismissible={!busy}
    >
      {item ? (
        <UnifiedItemDetail
          item={item}
          onClose={() => onOpenChange(false)}
          returnTo={returnTo}
          canManageEvents={canManageEvents}
          canManageLessons={canManageLessons}
          viewer={viewer}
          onBusyChange={setBusy}
          onItemUpdated={(updated) => {
            onItemChange(updated);
            onItemUpdated?.(updated);
          }}
          onItemRemoved={(removed) => {
            setBusy(false);
            onOpenChange(false);
            onItemRemoved?.(removed);
          }}
        />
      ) : null}
    </SlidePanel>
  );
}
