/**
 * @file src/components/digging/ColumnManager.tsx
 * @description 컬럼 추가/삭제 관리 다이얼로그.
 * isDefault 컬럼은 삭제 불가.
 */
"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { addDiggingColumn, deleteDiggingColumn } from "@/lib/actions/digging";
import type { DiggingColumnType } from "@/db/schema";

const COLUMN_TYPE_LABELS: Record<DiggingColumnType, string> = {
  text: "텍스트",
  textarea: "긴 텍스트",
  number: "숫자",
  select: "선택",
  rating: "별점",
  link: "링크",
  camelot_key: "카멜롯 키",
};

type Column = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  isDefault: boolean;
};

interface ColumnManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  onSuccess: () => void;
}

export function ColumnManager({
  open,
  onOpenChange,
  columns,
  onSuccess,
}: ColumnManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<DiggingColumnType>("text");
  const [newOptions, setNewOptions] = useState(""); // 쉼표 구분
  const [error, setError] = useState("");

  const handleAdd = () => {
    if (!newName.trim()) return;
    setError("");
    startTransition(async () => {
      try {
        const options = newType === "select"
          ? newOptions.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
        await addDiggingColumn({ name: newName.trim(), columnType: newType, options });
        setNewName("");
        setNewOptions("");
        onSuccess();
      } catch {
        setError("컬럼을 추가하지 못했습니다. 입력을 확인하고 다시 시도해 주세요.");
      }
    });
  };

  const columnDeleteConfirm = useConfirmAction<string>();

  const handleDelete = (colId: string) => {
    setError("");
    startTransition(async () => {
      try {
        await deleteDiggingColumn(colId);
        onSuccess();
      } catch {
        setError("컬럼을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent
        dismissible={!isPending}
        className="max-w-md"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          // 열린 삭제 확인이 있으면 Esc는 dialog 대신 확인만 닫는다.
          if (!columnDeleteConfirm.isOpen) return;
          event.preventDefault();
          if (!isPending) columnDeleteConfirm.close();
        }}
      >
        <DialogHeader>
          <DialogTitle>컬럼 관리</DialogTitle>
        </DialogHeader>

        {/* 현재 컬럼 목록 */}
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {columns.map((col) => (
            <div
              key={col.id}
              className="space-y-2 px-3 py-2 rounded-lg border border-border bg-muted/30"
            >
              <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{col.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {COLUMN_TYPE_LABELS[col.columnType]}
                </span>
                {col.isDefault && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
                    기본
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={(event) => columnDeleteConfirm.request(event.currentTarget, col.id)}
                disabled={col.isDefault || isPending}
                aria-expanded={col.isDefault ? undefined : columnDeleteConfirm.value === col.id}
                className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed ml-2 shrink-0"
                aria-label={`${col.name} 컬럼 삭제`}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              </div>
              {columnDeleteConfirm.value === col.id ? (
                <ConfirmPanel
                  confirm={columnDeleteConfirm}
                  message={`${col.name} 컬럼을 삭제할까요? 이 컬럼의 트랙 값은 다시 표시할 수 없습니다.`}
                  confirmLabel="컬럼 삭제 확인"
                  pendingLabel="삭제 중..."
                  pending={isPending}
                  onConfirm={() => handleDelete(col.id)}
                />
              ) : null}
            </div>
          ))}
        </div>

        {/* 컬럼 추가 폼 */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-medium">새 컬럼 추가</p>
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
          <div className="flex gap-2">
            <label htmlFor="digging-new-column-name" className="sr-only">새 컬럼 이름</label>
            <Input
              id="digging-new-column-name"
              placeholder="컬럼 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={isPending}
            />
            <label htmlFor="digging-new-column-type" className="sr-only">새 컬럼 유형</label>
            <select
              id="digging-new-column-type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as DiggingColumnType)}
              disabled={isPending}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(Object.entries(COLUMN_TYPE_LABELS) as [DiggingColumnType, string][]).map(
                ([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ),
              )}
            </select>
          </div>
          {newType === "select" && (
            <div>
              <label htmlFor="digging-new-column-options" className="text-xs font-medium text-muted-foreground">선택지</label>
              <Input id="digging-new-column-options" placeholder="쉼표로 구분, 예: 좋음,보통,별로" value={newOptions} onChange={(e) => setNewOptions(e.target.value)} disabled={isPending} />
            </div>
          )}
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim() || isPending}
            className="w-full gap-1.5"
            size="sm"
          >
            <Plus className="w-3.5 h-3.5" />
            추가
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
