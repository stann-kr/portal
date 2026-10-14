"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { PencilLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarEventType } from "@/db/schema";
import {
  deleteCalendarEvent,
  updateCalendarEventDetails,
  type CreateEventState,
} from "@/lib/actions/calendarEvents";
import { toKstDateTimeInputValue } from "@/lib/date-input";
import { createCalendarEventUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { CalendarEventFields, type CalendarEventFieldValues } from "./CalendarEventFields";

const EVENT_TYPES = new Set<CalendarEventType>(["LESSON", "PRACTICE", "GIG", "NOTE"]);

/** 포털에서 학생이 직접 만든 일정만 수정·삭제 대상이다. 레슨·외부 일정은 읽기 전용이다. */
export function isEditableCalendarEventItem(item: UnifiedItem): boolean {
  return item.type === "EVENT"
    && item.source.kind === "PORTAL"
    && item.source.entity === "CALENDAR_EVENT";
}

function fieldsFromItem(item: UnifiedItem): CalendarEventFieldValues {
  const description = item.description
    ?? (typeof item.metadata.description === "string" ? item.metadata.description : "");
  return {
    eventType: EVENT_TYPES.has(item.subType as CalendarEventType) ? item.subType as CalendarEventType : "NOTE",
    title: item.title,
    startTime: toKstDateTimeInputValue(item.date),
    endTime: item.endDate ? toKstDateTimeInputValue(new Date(item.endDate)) : "",
    description,
  };
}

export function CalendarEventActions({
  item,
  onUpdated,
  onDeleted,
  onBusyChange,
}: {
  item: UnifiedItem;
  onUpdated: (item: UnifiedItem) => void;
  onDeleted: (item: UnifiedItem) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [fields, setFields] = useState(() => fieldsFromItem(item));
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const titleInputId = `event-edit-${item.id}`;
  const [state, saveAction, isSaving] = useActionState<CreateEventState, FormData>(
    async (previous, data) => {
      try {
        const result = await updateCalendarEventDetails(previous, data);
        if (result.event) {
          const updated = createCalendarEventUnifiedItem({
            ...result.event,
            startTime: new Date(result.event.startTime),
            endTime: result.event.endTime ? new Date(result.event.endTime) : null,
          }, { id: item.space.studentId, email: item.space.label, displayName: item.space.label });
          setMode("view");
          setNotice("일정을 저장했습니다.");
          onUpdated(updated);
        }
        return result;
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 일정을 확인한 뒤 다시 시도해 주세요." };
      }
    },
    {},
  );
  const busy = isSaving || isDeleting;
  const formError = mode === "edit" && !isSaving ? state.error : undefined;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 삭제 확인은 되돌릴 수 없는 행동이므로 취소에 먼저 초점을 둔다.
  useEffect(() => {
    if (mode === "confirm-delete") cancelDeleteRef.current?.focus();
    if (mode === "edit") document.getElementById(`${titleInputId}-title`)?.focus();
  }, [mode, titleInputId]);

  const startEdit = () => {
    setFields(fieldsFromItem(item));
    setNotice(null);
    setDeleteError(null);
    setMode("edit");
  };

  const finishEdit = () => {
    setMode("view");
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const confirmDelete = () => {
    setDeleteError(null);
    startDelete(async () => {
      try {
        await deleteCalendarEvent(item.id);
        onDeleted(item);
      } catch {
        setDeleteError("일정을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  if (mode === "edit") {
    return (
      <form action={saveAction} className="space-y-4 rounded-lg border border-border p-4" aria-busy={isSaving} aria-label="일정 수정">
        <input type="hidden" name="eventId" value={item.id} />
        {formError ? (
          <p id={`${titleInputId}-error`} role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <CalendarEventFields
          idPrefix={titleInputId}
          values={fields}
          onChange={setFields}
          disabled={isSaving}
          errorId={formError ? `${titleInputId}-error` : undefined}
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={isSaving} className="flex-1">
            {isSaving ? "저장 중..." : "저장"}
          </Button>
          <Button type="button" variant="outline" onClick={finishEdit} disabled={isSaving}>
            취소
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      {mode === "confirm-delete" ? (
        <div role="group" aria-label="일정 삭제 확인" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive-muted p-3">
          <p className="text-sm text-foreground">이 일정을 삭제할까요? 삭제한 일정은 복구할 수 없습니다.</p>
          {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
          <div className="flex gap-2">
            <Button ref={cancelDeleteRef} type="button" variant="outline" size="sm" onClick={() => setMode("view")} disabled={isDeleting}>
              취소
            </Button>
            <Button type="button" variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "삭제 중..." : "삭제"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button ref={editButtonRef} type="button" variant="outline" size="sm" className="gap-1.5" onClick={startEdit}>
            <PencilLine className="size-3.5" aria-hidden="true" />
            일정 수정
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => { setNotice(null); setMode("confirm-delete"); }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            일정 삭제
          </Button>
        </div>
      )}
    </div>
  );
}
