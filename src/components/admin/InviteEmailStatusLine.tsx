import { Mail, MailWarning } from "lucide-react";
import type { InviteEmailStatus } from "@/lib/invite-email";
import { cn } from "@/lib/utils";

/** 가입 링크 메일 결과 한 줄(AdminStudentCreated 보드). 보내지 못했으면 아래 링크를 직접 전달하라고 알린다. */
export function InviteEmailStatusLine({ status, email, className }: { status: InviteEmailStatus; email: string; className?: string }) {
  const sent = status === "sent";
  const Icon = sent ? Mail : MailWarning;
  return (
    <p role="status" className={cn("flex items-start gap-2 text-ui", sent ? "text-foreground" : "text-destructive", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 break-words">
        {sent
          ? `${email}로 가입 링크를 보냈습니다.`
          : status === "failed"
            ? `${email}로 메일을 보내지 못했습니다. 아래 링크를 학생에게 직접 전달해 주세요.`
            : "메일 발송을 쓸 수 없는 환경입니다. 아래 링크를 학생에게 직접 전달해 주세요."}
      </span>
    </p>
  );
}

/** 링크 아래 안내. 메일을 보냈으면 오지 않았을 때만 직접 전달하면 된다. */
export function inviteLinkNotice(status: InviteEmailStatus, tail: string): string {
  return status === "sent"
    ? `메일이 오지 않았다면 이 링크를 직접 전달해 주세요. 이 화면을 벗어나면 다시 볼 수 없습니다.${tail}`
    : `이 화면을 벗어나면 다시 볼 수 없습니다. 학생에게 이 링크를 직접 전달해 주세요.${tail}`;
}
