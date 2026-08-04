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

import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { UnifiedItemTypeBadge } from "@/components/ui/unified-item-type";

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
}

export function UnifiedItemDetail({ item }: UnifiedItemDetailProps) {
  // metadata 값을 미리 문자열로 추출 (unknown → string | null 명확화)
  const metaDescription = metaStr(item.metadata, "description");
  const metaContentHtml = metaStr(item.metadata, "contentHtml");
  const metaLinkUrl = metaStr(item.metadata, "linkUrl");
  const metaMediaUrl = metaStr(item.metadata, "mediaUrl");
  const metaFeedbackCount = item.metadata.feedbackCount as number | undefined;

  return (
    <div className="space-y-5">
      {/* 타입 배지 + 날짜 */}
      <div className="flex items-center justify-between">
        <UnifiedItemTypeBadge item={item} />
        <span className="text-xs text-muted-foreground">
          {formatDate(item.date)}
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
          {item.endDate !== null && item.endDate !== undefined ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16">종료</span>
              <span>{formatDate(new Date(item.endDate))}</span>
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
        <div
          className="prose prose-sm max-w-none text-foreground prose-a:text-primary"
          dangerouslySetInnerHTML={{ __html: metaContentHtml }}
        />
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
