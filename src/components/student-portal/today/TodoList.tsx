import Link from "next/link";
import { Circle, MessageCircleReply } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatKstShortDate } from "@/lib/kst-format";
import type { StudentTodoEntry } from "@/lib/student-today";
import { HOME_ROW_CLASS } from "./HomeSection";

/** 할 일: 도착한 응답은 말풍선, 기다리는 항목은 빈 원으로 표시하는 체크리스트형 목록. */
export function TodoList({
  entries,
  referenceTime,
  returnTo,
}: {
  entries: StudentTodoEntry[];
  referenceTime: Date;
  returnTo: string;
}) {
  const encodedReturnTo = encodeURIComponent(returnTo);
  return (
    <ul className="space-y-0.5">
      {entries.map(({ item, status }) => {
        const isAssignment = item.type === "ASSIGNMENT";
        const href = isAssignment
          ? `/dashboard/student/assignments/${encodeURIComponent(item.id)}?returnTo=${encodedReturnTo}`
          : `/dashboard/qna/${encodeURIComponent(item.id)}?returnTo=${encodedReturnTo}`;
        const arrived = status === "feedbackReady" || status === "qnaAnswered";
        const Marker = arrived ? MessageCircleReply : Circle;
        return (
          <li key={`${item.type}-${item.id}`}>
            <Link href={href} className={`${HOME_ROW_CLASS} items-start`}>
              <Marker
                className={`mt-0.5 size-4 shrink-0 ${arrived ? "text-primary" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-foreground">{item.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {isAssignment ? "과제" : "Q&A"} · {formatKstShortDate(item.date, "", referenceTime)}
                    {isAssignment ? " 제출" : ""}
                  </span>
                </span>
              </span>
              <StatusBadge status={status} className="shrink-0 px-1.5 py-0.5 font-medium" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
