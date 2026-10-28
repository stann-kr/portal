/**
 * @file src/components/student-portal/UnifiedItemDetail.tsx
 * @description 상세 패널 본문(캔버스 CalendarDialogs): 20/28 제목, 72px 이름 칸의 32px 정보 줄,
 * 글자 2 설명, 유형별 조작. 노트는 UnifiedNoteDetail이 맡는다.
 *
 * 타입 노트:
 * - metadata 는 Record<string, unknown> → 모든 값은 String() 변환 후 JSX 삽입
 * - React 19 strict 타입에서 unknown && JSX 패턴은 금지 → 명시적 null 비교 삼항 연산자 사용
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Disc3, MessageSquareText } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemKindLabel } from "@/components/ui/unified-item-type";
import { buttonClassName } from "@/components/ui/button";
import { UnifiedNoteDetail, type NoteDetailViewer } from "./UnifiedNoteDetail";
import {
  CalendarEventActions,
  isEditableCalendarEventItem,
} from "@/components/calendar/CalendarEventActions";
import { isManagedLessonItem, LessonActions } from "@/components/calendar/LessonActions";
import { formatDetailDate, formatDetailMoment, shiftDateKey } from "@/components/calendar/calendar-dates";
import { toKstDateInputValue } from "@/lib/date-input";
import { buildAdminStudentDetailHref, buildStudentDiggingBoardHref } from "@/lib/student-space-routes";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";

// ── 타입 라벨 ────────────────────────────────────

const QNA_STATUS_LABELS: Record<string, string> = {
  OPEN: "답변 대기",
  ANSWERED: "답변 완료",
  CLOSED: "종료",
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

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

/** 정보 줄: 72px 이름 칸 · 값. 시각은 Mono 12. */
export function DetailRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-8 items-center text-ui">
      <dt className="w-[72px] shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? "min-w-0 font-mono text-xs" : "min-w-0 break-words"}>{children}</dd>
    </div>
  );
}

const linkButton = buttonClassName({ variant: "outline", className: "self-start px-3" });

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
  viewer?: NoteDetailViewer;
}

export function UnifiedItemDetail({
  item,
  returnTo,
  canManageEvents = false,
  canManageLessons = false,
  onItemUpdated,
  onItemRemoved,
  onBusyChange,
  viewer,
}: UnifiedItemDetailProps) {
  if (item.type === "NOTE") {
    return (
      <UnifiedNoteDetail
        key={item.id}
        item={item}
        returnTo={returnTo}
        viewer={viewer}
        onItemUpdated={onItemUpdated}
        onBusyChange={onBusyChange}
      />
    );
  }

  // metadata 값을 미리 문자열로 추출 (unknown → string | null 명확화)
  const metaDescription = metaStr(item.metadata, "description");
  const metaLinkUrl = metaStr(item.metadata, "linkUrl");
  const metaMediaUrl = metaStr(item.metadata, "mediaUrl");
  const allDayStartDate = metaStr(item.metadata, "allDayStartDate");
  const allDayEndDate = metaStr(item.metadata, "allDayEndDate");
  const metaFeedbackCount = item.metadata.feedbackCount as number | undefined;
  const isAllDay = item.metadata.allDay === true;
  const description = item.description ?? metaDescription;
  const isLesson = item.type === "EVENT" && item.subType === "LESSON";
  // 아직 제출하지 않은 관리자 과제는 마감 시각에 놓이고, 제출은 과제 화면에서 한다.
  const isOpenTask = item.source.entity === "ASSIGNMENT_TASK";

  // 종일 일정은 날짜만. 끝 날짜는 포함하지 않는 값으로 저장되므로 하루 앞을 보인다.
  const allDayStartKey = allDayStartDate && DATE_ONLY.test(allDayStartDate) ? allDayStartDate : toKstDateInputValue(item.date);
  const allDayLastKey = allDayEndDate && DATE_ONLY.test(allDayEndDate)
    ? shiftDateKey(allDayEndDate, -1)
    : item.endDate ? toKstDateInputValue(new Date(item.endDate)) : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="break-words text-xl font-semibold tracking-title">{item.title}</h2>

      <dl className="flex flex-col">
        {item.type === "EVENT" ? (
          isAllDay ? (
            <>
              <DetailRow label="날짜">{formatDetailDate(allDayStartKey)}</DetailRow>
              {allDayLastKey && allDayLastKey !== allDayStartKey ? (
                <DetailRow label="종료">{formatDetailDate(allDayLastKey)}</DetailRow>
              ) : null}
            </>
          ) : (
            <>
              <DetailRow label="시작" mono>{formatDetailMoment(item.date)}</DetailRow>
              {item.endDate ? <DetailRow label="종료" mono>{formatDetailMoment(new Date(item.endDate))}</DetailRow> : null}
            </>
          )
        ) : isOpenTask ? (
          <DetailRow label="마감" mono>{metaStr(item.metadata, "dueAt") ? formatDetailMoment(item.date) : "마감 없음"}</DetailRow>
        ) : (
          <DetailRow label="날짜" mono>{formatDetailMoment(item.date)}</DetailRow>
        )}
        {item.type === "EVENT" && !isLesson && item.subType !== undefined ? (
          <DetailRow label="종류">{getUnifiedItemKindLabel(item)}</DetailRow>
        ) : null}
        {item.source.kind !== "PORTAL" ? <DetailRow label="출처">{item.source.label}</DetailRow> : null}
        {item.type === "DIGGING" && metaLinkUrl ? (
          <DetailRow label="링크">
            <a
              href={metaLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-accent-foreground underline-offset-4 hover:underline"
            >
              {metaLinkUrl}
            </a>
          </DetailRow>
        ) : null}
        {item.type === "QNA" && item.subType !== undefined ? (
          <DetailRow label="상태">{QNA_STATUS_LABELS[item.subType] ?? item.subType}</DetailRow>
        ) : null}
        {item.type === "ASSIGNMENT" && metaFeedbackCount !== undefined && metaFeedbackCount > 0 ? (
          <DetailRow label="피드백"><span className="font-mono text-xs">{metaFeedbackCount}건</span></DetailRow>
        ) : null}
        {item.type === "ASSIGNMENT" && metaMediaUrl !== null ? (
          <DetailRow label="미디어">
            <a
              href={metaMediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-foreground underline-offset-4 hover:underline"
            >
              원본 열기
            </a>
          </DetailRow>
        ) : null}
      </dl>

      {description ? (
        <p className="whitespace-pre-wrap break-words text-body text-secondary-foreground">{description}</p>
      ) : null}

      {/* ── 타입별 조작 ── */}

      {item.type === "EVENT" ? (
        <>
          {canManageEvents && item.source.entity === "LESSON" ? (
            <p className="text-xs/[18px] text-muted-foreground">레슨 일정은 강사가 관리합니다.</p>
          ) : canManageEvents && item.source.kind !== "PORTAL" ? (
            <p className="text-xs/[18px] text-muted-foreground">연결한 외부 캘린더의 일정은 읽기 전용입니다.</p>
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
        </>
      ) : null}

      {item.type === "DIGGING" ? (
        <Link
          href={canManageEvents
            ? buildStudentDiggingBoardHref(returnTo)
            : buildAdminStudentDetailHref(item.space.studentId, "digging")}
          className={linkButton}
        >
          <Disc3 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          {canManageEvents ? "디깅 보드에서 편집" : "디깅 보드에서 보기"}
        </Link>
      ) : null}

      {item.type === "QNA" ? (
        <Link
          href={`/dashboard/qna/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}
          className={linkButton}
        >
          전체 대화에서 이어보기
        </Link>
      ) : null}

      {isOpenTask ? (
        <Link
          // canManageEvents는 학생 본인 스페이스다.
          href={canManageEvents ? STUDENT_LEGACY_REDIRECTS.assignments : buildAdminStudentDetailHref(item.space.studentId, "assignments")}
          className={linkButton}
        >
          {canManageEvents ? "과제 화면에서 제출하기" : "학생 과제 관리"}
        </Link>
      ) : item.type === "ASSIGNMENT" ? (
        <Link
          href={`/dashboard/student/assignments/${encodeURIComponent(item.id)}?returnTo=${encodeURIComponent(returnTo)}`}
          className={linkButton}
        >
          <MessageSquareText className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
          {metaMediaUrl === null
            ? canManageEvents ? "제출과 피드백 보기" : "제출 보고 피드백 작성"
            : canManageEvents ? "재생하며 피드백 보기" : "재생하며 피드백 작성"}
        </Link>
      ) : null}
    </div>
  );
}
