"use client";

import { useState, useTransition } from "react";
import { AccountStatusRow, ACCOUNT_ACTION_BUTTON_CLASS, OneTimeSecret } from "@/components/admin/OneTimeSecret";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { reissueStudentInvite } from "@/lib/actions/students";
import { INVITE_LIFETIME_MS } from "@/lib/invite-token";
import { formatKst } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

const EXPIRES_FORMAT: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };

/**
 * 아직 가입하지 않은 학생의 가입 링크 재발급. 링크는 발급 직후 한 번만 보여 준다.
 * 쓸 수 있는 링크가 남아 있으면 재발급이 그 링크를 바로 끊으므로 취소 우선 확인을 거친다.
 * 계정 구역에서 상태 줄(가입)과 조작(버튼·확인·발급 값)을 따로 배치할 수 있게 둘을 형제로 그린다.
 */
export function StudentInviteControl({
  studentId,
  expiresAt,
  expired,
  statusClassName,
  actionsClassName,
}: {
  studentId: string;
  expiresAt: Date;
  /** 서버가 판단한 현재 링크의 만료 여부. */
  expired: boolean;
  statusClassName?: string;
  actionsClassName?: string;
}) {
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState(expiresAt);
  const [hasLiveLink, setHasLiveLink] = useState(!expired);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const reissueConfirm = useConfirmAction();

  const reissue = () => {
    setError(null);
    startTransition(async () => {
      try {
        const path = await reissueStudentInvite(studentId);
        setInvitePath(path);
        setLinkExpiresAt(new Date(Date.now() + INVITE_LIFETIME_MS));
        setHasLiveLink(true);
      } catch {
        setError("가입 링크를 발급하지 못했습니다. 학생이 이미 가입했다면 새로고침해 주세요.");
      }
    });
  };

  const inviteUrl = invitePath && typeof window !== "undefined" ? `${window.location.origin}${invitePath}` : invitePath;

  return (
    <>
      <AccountStatusRow label="가입" className={statusClassName}>
        {hasLiveLink
          ? `대기 · 가입 링크는 ${formatKst(linkExpiresAt, EXPIRES_FORMAT)}까지 한 번 쓸 수 있습니다`
          : "대기 · 가입 링크가 만료됐습니다. 새 링크를 발급해 전달해 주세요"}
      </AccountStatusRow>

      <div className={cn("flex flex-col", actionsClassName)}>
        <Button
          type="button"
          variant="outline"
          className={ACCOUNT_ACTION_BUTTON_CLASS}
          disabled={isPending}
          aria-expanded={hasLiveLink ? reissueConfirm.isOpen : undefined}
          onClick={(event) => {
            if (hasLiveLink) reissueConfirm.request(event.currentTarget);
            else reissue();
          }}
        >
          {isPending ? "발급 중…" : "가입 링크 다시 발급"}
        </Button>

        {reissueConfirm.isOpen ? (
          <ConfirmPanel
            confirm={reissueConfirm}
            message="새 링크를 발급하면 이전에 보낸 가입 링크는 바로 쓸 수 없게 됩니다. 발급할까요?"
            confirmLabel="가입 링크 다시 발급 확인"
            pendingLabel="발급 중…"
            pending={isPending}
            onConfirm={reissue}
            className="mt-2"
          />
        ) : null}

        <div aria-live="polite" aria-atomic="true" className="[&:not(:empty)]:mt-3">
          {inviteUrl ? (
            <OneTimeSecret
              key={inviteUrl}
              label="가입 링크"
              value={inviteUrl}
              notice="이 화면을 벗어나면 다시 볼 수 없습니다. 학생에게 이 링크를 직접 전달해 주세요."
            />
          ) : null}
        </div>

        {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </>
  );
}
