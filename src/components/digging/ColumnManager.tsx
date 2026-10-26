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
        <ul className="-mx-1 flex max-h-60 flex-col overflow-y-auto px-1">
          {columns.map((col) => (
            <li key={col.id} className="flex flex-col gap-2 border-b border-muted py-1.5 last:border-b-0">
              <div className="flex min-h-11 items-center justify-between gap-2 md:min-h-8">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-body font-medium">{col.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {COLUMN_TYPE_LABELS[col.columnType]}
                  </span>
                  {col.isDefault && (
                    <span className="shrink-0 rounded-sm bg-muted px-1.5 text-xs leading-5 text-secondary-foreground">
                      기본
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(event) => columnDeleteConfirm.request(event.currentTarget, col.id)}
                  disabled={col.isDefault || isPending}
                  aria-expanded={col.isDefault ? undefined : columnDeleteConfirm.value === col.id}
                  className="flex size-11 shrink-0 items-center justify-center rounded-touch text-muted-foreground transition-colors hover:bg-destructive-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent md:size-8 md:rounded-md"
                  aria-label={`${col.name} 컬럼 삭제`}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
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
            </li>
          ))}
        </ul>

        {/* 컬럼 추가 폼 */}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-ui font-semibold text-secondary-foreground">새 컬럼 추가</p>
          {error ? <p className="text-ui text-destructive" role="alert">{error}</p> : null}
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
              className="h-11 shrink-0 rounded-touch border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:h-9 md:rounded-md md:text-sm"
            >
              {(Object.entries(COLUMN_TYPE_LABELS) as [DiggingColumnType, string][]).map(
                ([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ),
              )}
            </select>
          </div>
          {newType === "select" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="digging-new-column-options" className="text-xs text-muted-foreground">선택지</label>
              <Input id="digging-new-column-options" placeholder="쉼표로 구분, 예: 좋음,보통,별로" value={newOptions} onChange={(e) => setNewOptions(e.target.value)} disabled={isPending} />
            </div>
          )}
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim() || isPending}
            size="touch"
            className="w-full md:h-8 md:rounded-md md:text-ui"
          >
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            추가
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
