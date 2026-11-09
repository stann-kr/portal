/**
 * @file src/components/student-portal/AssignmentBrief.tsx
 * @description Stann이 낸 과제 설명을 접고 펼치는 상자(UsabilityBundle ②).
 * 분석 쓰기 화면 맨 위(처음부터 펼침)와 학생 과제 목록 행(피드백이 달려 잠겨도 펼칠 수 있음)에서 쓴다.
 */
import { RichTextContent } from "@/components/editor/RichTextContent";
import { cn } from "@/lib/utils";

export function AssignmentBrief({
  html,
  open = false,
  className,
}: {
  html: string;
  /** 처음 펼친 채로 둘지. 바뀌어 true가 되면 다시 펼친다(사용자가 접은 뒤에는 그대로 둔다). */
  open?: boolean;
  className?: string;
}) {
  return (
    <details open={open} className={cn("group rounded-lg border border-border px-3.5 py-3", className)}>
      <summary className="cursor-pointer text-ui font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Stann의 과제 설명
      </summary>
      <RichTextContent html={html} className="mt-2 text-body leading-[22px] text-secondary-foreground" />
    </details>
  );
}
