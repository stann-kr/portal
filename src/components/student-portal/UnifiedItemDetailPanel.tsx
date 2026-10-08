"use client";

import { useState } from "react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";

export type UnifiedItemChangeHandlers = {
  /** 학생 본인 스페이스에서만 포털 일정을 수정·삭제할 수 있다. */
  canManageEvents?: boolean;
  /** 관리자 일정에서 선택 학생의 레슨 시간을 바꾸거나 삭제할 수 있다. */
  canManageLessons?: boolean;
  onItemUpdated?: (item: UnifiedItem) => void;
  onItemRemoved?: (item: UnifiedItem) => void;
};

/** 캘린더·일별·전체 보기가 같은 상세 패널과 변경 중 닫힘 잠금을 공유한다. */
export function UnifiedItemDetailPanel({
  item,
  open,
  onOpenChange,
  onItemChange,
  returnTo,
  canManageEvents = false,
  canManageLessons = false,
  onItemUpdated,
  onItemRemoved,
}: {
  item: UnifiedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 수정된 항목을 패널이 계속 보여 주도록 선택 상태를 갱신한다. */
  onItemChange: (item: UnifiedItem) => void;
  returnTo: string;
} & UnifiedItemChangeHandlers) {
  const [busy, setBusy] = useState(false);

  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={item?.title}
      dismissible={!busy}
    >
      {item ? (
        <UnifiedItemDetail
          item={item}
          onClose={() => onOpenChange(false)}
          returnTo={returnTo}
          canManageEvents={canManageEvents}
          canManageLessons={canManageLessons}
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
