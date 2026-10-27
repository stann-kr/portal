"use client";

import { useState, useRef, useEffect } from "react";
import { getUnifiedItemKey, type UnifiedItem } from "@/lib/utils/unifiedItemUtils";
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
 * 넓은 화면(`SlidePanelDock` 안)은 캘린더 옆 비모달 패널, 좁은 화면은 모달 시트다.
 * 머리 왼쪽은 유형 점·이름과 (관리자·외부 출처) 학생 칩. 노트는 유형 대신 저장 상태(편집할 때)를
 * 노트 상세가 채우고, 전체 화면 열기를 닫기 옆에 둔다(캔버스 Calendar 보드 노트 패널).
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
  // 저장이 끝났을 때 사용자가 그사이 고른 항목(최신 item)을 덮어쓰지 않도록 마지막 요청을 기억한다.
  const requestedKey = item ? getUnifiedItemKey(item) : null;
  const requestedKeyRef = useRef<string | null>(requestedKey);
  useEffect(() => {
    requestedKeyRef.current = requestedKey;
  }, [requestedKey]);
  // 넓은 화면 패널은 비모달이라 저장·삭제 중에도 캘린더의 다른 항목·보기를 누를 수 있다.
  // 그동안은 지금 항목과 열림을 붙잡아 두고(같은 항목의 저장 결과만 반영), 끝나면 마지막 요청을 따른다.
  const [shown, setShown] = useState({ item, open });
  const shownKey = shown.item ? getUnifiedItemKey(shown.item) : null;
  const canFollow = !busy || (open && item !== null && getUnifiedItemKey(item) === shownKey);
  if (canFollow && (shown.item !== item || shown.open !== open)) setShown({ item, open });
  const current = canFollow ? item : shown.item;
  const isOpen = canFollow ? open : shown.open;
  const isNote = current?.type === "NOTE";

  return (
    <SlidePanel
      open={isOpen}
      onOpenChange={onOpenChange}
      title={isNote ? "노트" : current?.title}
      headerStart={current ? (
        <>
          {isNote ? null : <UnifiedItemTypeBadge item={current} />}
          {showSpaceContext || current.source.kind !== "PORTAL" ? <UnifiedItemSpaceBadge item={current} /> : null}
        </>
      ) : undefined}
      size={isNote ? "note" : "md"}
      dismissible={!busy}
      docked
      contentKey={current ? getUnifiedItemKey(current) : undefined}
    >
      {current ? (
        <UnifiedItemDetail
          // 항목마다 편집·삭제 확인 상태를 새로 시작한다. 다른 칩으로 바꿨을 때 이전 항목의 편집값이 남아
          // 새 항목 이름으로 저장되지 않게 한다.
          key={getUnifiedItemKey(current)}
          item={current}
          onClose={() => onOpenChange(false)}
          returnTo={returnTo}
          canManageEvents={canManageEvents}
          canManageLessons={canManageLessons}
          viewer={viewer}
          onBusyChange={setBusy}
          onItemUpdated={(updated) => {
            const requestedKey = requestedKeyRef.current;
            if (requestedKey === null || requestedKey === getUnifiedItemKey(updated)) onItemChange(updated);
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
