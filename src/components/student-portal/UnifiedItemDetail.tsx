/**
 * @file src/components/student-portal/UnifiedItemDetail.tsx
 * @description SlidePanel 내 UnifiedItem 타입별 상세 뷰.
 * EVENT / NOTE / DIGGING / QNA / ASSIGNMENT 분기 렌더링.
 *
 * 타입 노트:
 * - metadata 는 Record<string, unknown> → 모든 값은 String() 변환 후 JSX 삽입
 * - React 19 strict 타입에서 unknown && JSX 패턴은 금지 → 명시적 null 비교 삼항 연산자 사용
 */
"use client";

import Link from "next/link";
import { Disc3, MessageSquareText } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { UnifiedItemSpaceBadge, UnifiedItemTypeBadge } from "@/components/ui/unified-item-type";
import { UnifiedNoteDetail } from "./UnifiedNoteDetail";
import {
  CalendarEventActions,
  isEditableCalendarEventItem,
} from "@/components/calendar/CalendarEventActions";
import { isManagedLessonItem, LessonActions } from "@/components/calendar/LessonActions";
import { formatKst } from "@/lib/kst-format";
import { buildAdminStudentDetailHref, buildStudentDiggingBoardHref } from "@/lib/student-space-routes";

// ── 타입 라벨 ────────────────────────────────────

const QNA_STATUS_LABELS: Record<string, string> = {
  OPEN: "답변 대기",
  ANSWERED: "답변 완료",
  CLOSED: "종료",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  LESSON: "레슨", PRACTICE: "연습", GIG: "공연", NOTE: "메모",
};

// ── 포맷 헬퍼 ────────────────────────────────────

const DATE_LABEL: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

function formatDate(date: Date) {
  return formatKst(date, { ...DATE_LABEL, hour: "2-digit", minute: "2-digit" });
}

// date-only 값은 UTC 자정으로 만들어 KST(+9)에서도 같은 날짜로 표시한다.
function formatAllDayDate(date: Date, dateOnly: string | null) {
  const exactDate = dateOnly && /^\d{4}-\d{2}-\d{2}$/u.test(dateOnly)
    ? new Date(`${dateOnly}T00:00:00.000Z`)
    : new Date(date);
  return formatKst(exactDate, DATE_LABEL);
}

function formatAllDayEndDate(date: Date, dateOnly: string | null) {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/u.test(dateOnly)) {
    return formatAllDayDate(date, null);
  }
  const inclusiveEnd = new Date(`${dateOnly}T00:00:00.000Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  return formatKst(inclusiveEnd, DATE_LABEL);
}

/**
 * metadata 필드에서 문자열 값을 안전하게 추출.
 * null / undefined → null 반환.
 */
function metaStr(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const val = metadata[key];
  if (val === null || val === undefined) return null;
  return String(val);
}

// ── 컴포넌트 ─────────────────────────────────────

interface UnifiedItemDetailProps {
  item: UnifiedItem;
  onClose: () => void;
  returnTo: string;
  canManageEvents?: boolean;
  canManageLessons?: boolean;
  onItemUpdated?: (item: UnifiedItem) => void;
  onItemRemoved?: (item: UnifiedItem) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function UnifiedItemDetail({
  item,
  returnTo,
  canManageEvents = false,
  canManageLessons = false,
  onItemUpdated,
  onItemRemoved,
  onBusyChange,
}: UnifiedItemDetailProps) {
  // metadata 값을 미리 문자열로 추출 (unknown → string | null 명확화)
  const metaDescription = metaStr(item.metadata, "description");
  const metaPreview = metaStr(item.metadata, "preview");
  const metaLinkUrl = metaStr(item.metadata, "linkUrl");
  const metaMediaUrl = metaStr(item.metadata, "mediaUrl");
  const allDayStartDate = metaStr(item.metadata, "allDayStartDate");
  const allDayEndDate = metaStr(item.metadata, "allDayEndDate");
  const metaFeedbackCount = item.metadata.feedbackCount as number | undefined;
  const isAllDay = item.metadata.allDay === true;
  const description = item.type === "NOTE"
    ? null
    : item.description ?? metaDescription;
  const startLabel = isAllDay
    ? formatAllDayDate(item.date, allDayStartDate)
    : formatDate(item.date);
  const endLabel = item.endDate
    ? isAllDay
      ? formatAllDayEndDate(new Date(item.endDate), allDayEndDate)
      : formatDate(new Date(item.endDate))
    : null;

  return (
    <div className="space-y-5">
      {/* 타입 배지 + 날짜 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UnifiedItemTypeBadge item={item} />
          <UnifiedItemSpaceBadge item={item} />
        </div>
        <span className="text-xs text-muted-foreground">
          {startLabel}
        </span>
      </div>

      {description ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}

      {/* ── 타입별 추가 정보 ── */}

      {/* EVENT */}
      {item.type === "EVENT" ? (
        <div className="space-y-2 text-sm">
          {item.subType !== undefined ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">종류</span>
              <span className="font-medium">{EVENT_TYPE_LABELS[item.subType] ?? "일정"}</span>
            </div>
          ) : null}
          {endLabel !== null && (!isAllDay || endLabel !== startLabel) ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">종료</span>
              <span>{endLabel}</span>
            </div>
          ) : null}
          {canManageEvents && item.source.entity === "LESSON" ? (
            <p className="text-xs text-muted-foreground">레슨 일정은 강사가 관리합니다.</p>
          ) : canManageEvents && item.source.kind !== "PORTAL" ? (
            <p className="text-xs text-muted-foreground">연결한 외부 캘린더의 일정은 읽기 전용입니다.</p>
          ) : null}
          {canManageEvents && isEditableCalendarEventItem(item) && onItemUpdated && onItemRemoved ? (
            <CalendarEventActions
              item={item}
              onUpdated={onItemUpdated}
              onDeleted={onItemRemoved}
              onBusyChange={onBusyChange}
            />
          ) : null}
          {canManageLessons && isManagedLessonItem(item) && onItemUpdated && onItemRemoved ? (
            <LessonActions
              item={item}
              onUpdated={onItemUpdated}
              onDeleted={onItemRemoved}
              onBusyChange={onBusyChange}
            />
          ) : null}
        </div>
      ) : null}

      {/* NOTE */}
      {item.type === "NOTE" ? (
        <UnifiedNoteDetail key={item.id} noteId={item.id} preview={metaPreview} returnTo={returnTo} />
      ) : null}

      {/* DIGGING */}
      {item.type === "DIGGING" ? (
        <div className="space-y-3 text-sm">
          {metaLinkUrl ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16 shrink-0">링크</span>
              <a
                href={metaLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-primary hover:underline"
              >
                {metaLinkUrl}
              </a>
            </div>
          ) : null}
          <Link
            href={canManageEvents
              ? buildStudentDiggingBoardHref(returnTo)
              : buildAdminStudentDetailHref(item.space.studentId, "digging")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Disc3 className="h-3.5 w-3.5" aria-hidden="true" />
            {canManageEvents ? "디깅 보드에서 편집" : "디깅 보드에서 보기"}
          </Link>
        </div>
      ) : null}

      {/* QNA */}
      {item.type === "QNA" ? (
        <div className="space-y-2 text-sm">
          {item.subType !== undefined ? (
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground w-16">상태</span>
              <span className="px-2 py-0.5 text-xs border border-border rounded-full">
                {QNA_STATUS_LABELS[item.subType] ?? item.subType}
              </span>
            </div>
          ) : null}
          <Link
            href={`/dashboard/qna/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            전체 대화에서 이어보기
          </Link>
        </div>
      ) : null}

      {/* ASSIGNMENT */}
      {item.type === "ASSIGNMENT" ? (
        <div className="space-y-2 text-sm">
          {metaFeedbackCount !== undefined && metaFeedbackCount > 0 ? (
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground w-16">피드백</span>
              <span className="px-2 py-0.5 text-xs bg-muted rounded-full">
                {metaFeedbackCount}건
              </span>
            </div>
          ) : null}
          {metaMediaUrl !== null ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">미디어</span>
              <a
                href={metaMediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
              >
                원본 열기
              </a>
            </div>
          ) : null}
          <Link
            href={`/dashboard/student/assignments/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            {canManageEvents ? "재생하며 피드백 보기" : "재생하며 피드백 작성"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
