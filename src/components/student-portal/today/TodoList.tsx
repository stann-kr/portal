import Link from "next/link";
import { formatKstDot, formatKstShortDate } from "@/lib/kst-format";
import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
import { getAssignmentTaskDueAt, type StudentTodoEntry, type StudentTodoStatus } from "@/lib/student-today";
import { cn } from "@/lib/utils";
import { LEDGER_ROW_CLASS } from "./HomeSection";

/** 할 일 제목: 항목 이름 대신 지금 확인할 일을 문장으로 적는다(Main 보드). */
const TODO_TITLES: Record<StudentTodoStatus, string> = {
  taskOverdue: "마감이 지난 과제",
  taskDue: "제출할 과제",
  feedbackReady: "피드백이 도착했어요",
  qnaAnswered: "질문에 답변이 달렸어요",
  feedbackWaiting: "피드백을 기다리는 과제",
  qnaOpen: "답변을 기다리는 질문",
};

function describeTodo({ item, status }: StudentTodoEntry, referenceTime: Date): string {
  if (item.type !== "ASSIGNMENT") return item.title;
  if (status === "taskDue" || status === "taskOverdue") {
    const dueAt = getAssignmentTaskDueAt(item);
    return dueAt ? `${item.title} · ${formatKstDot(dueAt, { weekday: true, time: true, referenceTime })} 마감` : item.title;
  }
  const date = formatKstShortDate(item.date, "", referenceTime);
  if (!date) return item.title;
  return status === "feedbackWaiting" ? `${item.title} · ${date} 제출` : `${item.title} · ${date}`;
}

/** 할 일: 빈 체크 칸 · 확인할 일 · 항목 이름과 날짜. 낼 과제는 과제 화면, 제출은 과제 상세, 질문은 Q&A 스레드로 연결한다. */
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
    <ul>
      {entries.map((entry) => {
        const { item, status } = entry;
        // 낼 과제는 제출 폼이 있는 과제 화면으로, 제출한 과제는 제출 상세로 보낸다.
        const href = status === "taskDue" || status === "taskOverdue"
          ? STUDENT_LEGACY_REDIRECTS.assignments
          : item.type === "ASSIGNMENT"
          ? `/dashboard/student/assignments/${encodeURIComponent(item.id)}?returnTo=${encodedReturnTo}`
          : `/dashboard/qna/${encodeURIComponent(item.id)}?returnTo=${encodedReturnTo}`;
        return (
          <li key={`${item.type}-${item.id}`}>
            <Link href={href} className={cn(LEDGER_ROW_CLASS, "flex items-start gap-3 py-[13px] md:gap-2.5 md:px-1 md:py-3")}>
              <span
                aria-hidden="true"
                className="mt-[3px] size-4 shrink-0 rounded-sm border-[1.5px] border-faint md:size-3.5"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-md md:text-body">{TODO_TITLES[status]}</span>
                <span className="truncate text-ui leading-[18px] text-muted-foreground md:text-xs">
                  {describeTodo(entry, referenceTime)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
