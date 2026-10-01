/**
 * @file src/components/digging/AddTrackDialog.tsx
 * @description 트랙 추가 다이얼로그. AddTrackInlineForm을 Dialog로 감싼 래퍼.
 */
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AddTrackInlineForm } from "./AddTrackInlineForm";
import type { DiggingColumnType } from "@/db/schema";
import { createDiggingTrackUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

type Column = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  options: string | null | undefined;
};

interface AddTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  studentId?: string;
  spaceLabel?: string;
  onSuccess: (item: UnifiedItem) => void;
}

export function AddTrackDialog({
  open,
  onOpenChange,
  columns,
  studentId,
  spaceLabel,
  onSuccess,
}: AddTrackDialogProps) {
  const [busy, setBusy] = useState(false);
  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!busy) onOpenChange(nextOpen); }}>
      <DialogContent dismissible={!busy} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>트랙 추가</DialogTitle>
          <DialogDescription>참고할 트랙의 링크와 정보를 기록하세요.</DialogDescription>
        </DialogHeader>
        <AddTrackInlineForm
          columns={columns}
          onBusyChange={setBusy}
          onSuccess={(created) => {
            handleClose();
            onSuccess(createDiggingTrackUnifiedItem(created, columns, {
              id: studentId ?? "current-student",
              email: spaceLabel || "내 스페이스",
              displayName: spaceLabel || "내 스페이스",
            }));
          }}
          onCancel={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
