/**
 * @file src/components/digging/AddTrackDialog.tsx
 * @description 트랙 추가 다이얼로그. AddTrackInlineForm을 Dialog로 감싼 래퍼.
 */
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddTrackInlineForm } from "./AddTrackInlineForm";
import type { DiggingColumnType } from "@/db/schema";

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
  onSuccess: () => void;
}

export function AddTrackDialog({
  open,
  onOpenChange,
  columns,
  onSuccess,
}: AddTrackDialogProps) {
  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>트랙 추가</DialogTitle>
        </DialogHeader>
        <AddTrackInlineForm
          columns={columns}
          onSuccess={() => {
            handleClose();
            onSuccess();
          }}
          onCancel={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
