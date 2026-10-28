import { cn } from "@/lib/utils";

const MESSAGE_CLASS = "text-ui empty:hidden md:text-xs";

/** `id`(성공)와 `${id}-error`(오류)를 함께 가리키는 aria-describedby 값. */
export function feedbackDescribedBy(id: string): string {
  return `${id} ${feedbackErrorId(id)}`;
}

export function feedbackErrorId(id: string): string {
  return `${id}-error`;
}

/**
 * 성공은 role="status"(polite), 오류는 role="alert"로 따로 알린다(운영 도구 화면과 같은 방식).
 * 두 영역은 항상 DOM에 두고 내용만 바꿔 읽기 프로그램이 변경을 놓치지 않게 한다.
 */
export function FeedbackMessages({ id, error, success }: { id: string; error?: string; success?: string }) {
  return (
    <>
      <p id={id} role="status" aria-live="polite" aria-atomic="true" className={cn(MESSAGE_CLASS, "text-success")}>
        {error ? "" : (success ?? "")}
      </p>
      <p id={feedbackErrorId(id)} role="alert" className={cn(MESSAGE_CLASS, "text-destructive")}>
        {error ?? ""}
      </p>
    </>
  );
}
