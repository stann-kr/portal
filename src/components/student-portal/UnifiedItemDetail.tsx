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
import { PencilLine } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { UnifiedItemSpaceBadge, UnifiedItemTypeBadge } from "@/components/ui/unified-item-type";
import { RichTextContent } from "@/components/editor/RichTextContent";

// ── 타입 라벨 ────────────────────────────────────

const QNA_STATUS_LABELS: Record<string, string> = {
  OPEN: "답변 대기",
  ANSWERED: "답변 완료",
  CLOSED: "종료",
};

// ── 포맷 헬퍼 ────────────────────────────────────

function formatDate(date: Date) {
  return new Date(date).toLocaleString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAllDayDate(date: Date, dateOnly: string | null) {
  const exactDate = dateOnly && /^\d{4}-\d{2}-\d{2}$/u.test(dateOnly)
    ? new Date(`${dateOnly}T00:00:00.000Z`)
    : new Date(date);
  return exactDate.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
}

function formatAllDayEndDate(date: Date, dateOnly: string | null) {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/u.test(dateOnly)) {
    return formatAllDayDate(date, null);
  }
  const inclusiveEnd = new Date(`${dateOnly}T00:00:00.000Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  return inclusiveEnd.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
}

export function UnifiedItemDetail({ item, returnTo }: UnifiedItemDetailProps) {
  // metadata 값을 미리 문자열로 추출 (unknown → string | null 명확화)
  const metaDescription = metaStr(item.metadata, "description");
  const metaContentHtml = metaStr(item.metadata, "contentHtml");
  const metaLinkUrl = metaStr(item.metadata, "linkUrl");
  const metaMediaUrl = metaStr(item.metadata, "mediaUrl");
  const allDayStartDate = metaStr(item.metadata, "allDayStartDate");
  const allDayEndDate = metaStr(item.metadata, "allDayEndDate");
  const metaFeedbackCount = item.metadata.feedbackCount as number | undefined;
  const isAllDay = item.metadata.allDay === true;
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UnifiedItemTypeBadge item={item} />
          <UnifiedItemSpaceBadge item={item} />
        </div>
        <span className="text-xs text-muted-foreground">
          {startLabel}
        </span>
      </div>

      {/* 제목 */}
      <h3 className="text-base font-semibold text-foreground leading-snug">
        {item.title}
      </h3>

      {/* 설명 (description은 string | undefined — string으로 좁혀짐) */}
      {typeof item.description === "string" ? (
        <p className="text-sm text-muted-foreground">{item.description}</p>
      ) : null}

      {/* ── 타입별 추가 정보 ── */}

      {/* EVENT */}
      {item.type === "EVENT" ? (
        <div className="space-y-2 text-sm">
          {item.subType !== undefined ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">종류</span>
              <span className="font-medium">{item.subType}</span>
            </div>
          ) : null}
          {endLabel !== null && (!isAllDay || endLabel !== startLabel) ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">종료</span>
              <span>{endLabel}</span>
            </div>
          ) : null}
          {metaDescription !== null ? (
            <div className="pt-2 text-sm text-muted-foreground">
              {metaDescription}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* NOTE */}
      {item.type === "NOTE" && metaContentHtml !== null ? (
        <div className="space-y-5">
          <RichTextContent html={metaContentHtml} />
          <Link
            href={`/dashboard/notes/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
            전체 화면에서 이어쓰기
          </Link>
        </div>
      ) : null}

      {/* DIGGING */}
      {item.type === "DIGGING" && metaLinkUrl !== null ? (
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-16">링크</span>
            <a
              href={metaLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline truncate"
            >
              {metaLinkUrl}
            </a>
          </div>
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
          <p className="text-xs text-muted-foreground pt-1">
            전체 Q&A 보기는 상단 메뉴에서 Q&A 섹션을 이용하세요.
          </p>
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
                재생하기
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
