"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  changeOwnPassword,
  type ChangePasswordField,
  type ChangePasswordState,
} from "@/lib/actions/password";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

const EMPTY_FIELDS: Record<ChangePasswordField, string> = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const FIELD_LABELS: Record<ChangePasswordField, string> = {
  currentPassword: "현재 비밀번호",
  newPassword: "새 비밀번호",
  confirmPassword: "새 비밀번호 확인",
};

const FIELD_AUTOCOMPLETE: Record<ChangePasswordField, string> = {
  currentPassword: "current-password",
  newPassword: "new-password",
  confirmPassword: "new-password",
};

function PasswordChangeForm({
  onDone,
  onBusyChange,
}: {
  onDone: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const baseId = useId();
  // form action은 uncontrolled 입력을 비우므로 거부된 뒤에도 고칠 수 있게 값을 제어한다.
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const inputRefs = useRef<Partial<Record<ChangePasswordField, HTMLInputElement | null>>>({});
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    async (previous, data) => {
      try {
        const result = await changeOwnPassword(previous, data);
        if (result.success) setFields(EMPTY_FIELDS);
        return result;
      } catch {
        return { error: "변경 결과를 확인하지 못했습니다. 새 비밀번호로 로그인되는지 확인한 뒤 다시 시도해 주세요." };
      }
    },
    {},
  );
  const errorId = `${baseId}-error`;

  useEffect(() => {
    if (state.field) inputRefs.current[state.field]?.focus();
  }, [state]);

  useEffect(() => {
    onBusyChange(pending);
  }, [onBusyChange, pending]);

  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  if (state.success) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-md bg-success-muted px-3 py-2 text-sm text-success">
          {state.signInRequired
            ? "비밀번호를 변경했습니다. 이 기기에서도 새 비밀번호로 다시 로그인해 주세요."
            : "비밀번호를 변경했습니다. 다른 기기의 기존 로그인은 다음 요청부터 만료됩니다."}
        </p>
        {state.signInRequired ? (
          <Button type="button" className="w-full" onClick={() => window.location.assign("/login")}>
            로그인 화면으로 이동
          </Button>
        ) : (
          <Button type="button" variant="outline" className="w-full" onClick={onDone}>
            닫기
          </Button>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      {(Object.keys(FIELD_LABELS) as ChangePasswordField[]).map((field) => {
        const inputId = `${baseId}-${field}`;
        const invalid = !pending && state.field === field;
        return (
          <div key={field} className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">{FIELD_LABELS[field]}</label>
            <Input
              ref={(element) => { inputRefs.current[field] = element; }}
              id={inputId}
              name={field}
              type="password"
              required
              autoComplete={FIELD_AUTOCOMPLETE[field]}
              minLength={field === "currentPassword" ? undefined : PASSWORD_MIN_LENGTH}
              value={fields[field]}
              onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))}
              disabled={pending}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : field === "newPassword" ? `${inputId}-help` : undefined}
            />
            {field === "newPassword" ? (
              <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
                {PASSWORD_MIN_LENGTH}자 이상으로 입력해 주세요.
              </p>
            ) : null}
          </div>
        );
      })}
      {state.error && !pending ? (
        <p id={errorId} role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "변경 중..." : "비밀번호 변경"}
      </Button>
    </form>
  );
}

/** 사이드 레일의 본인 비밀번호 변경. 변경 중에는 대화상자를 닫지 못하게 한다. */
export function PasswordChangeControl() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy) return;
        setOpen(nextOpen);
        // 닫았다 다시 열면 이전 입력과 결과 없이 새 form으로 시작한다.
        if (!nextOpen) setFormKey((key) => key + 1);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="비밀번호 변경"
          title="비밀번호 변경"
        >
          <KeyRound className="size-4" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent dismissible={!busy} className="max-w-md">
        <DialogHeader>
          <DialogTitle>비밀번호 변경</DialogTitle>
          <DialogDescription>
            현재 비밀번호를 확인한 뒤 바꿉니다. 이 기기의 로그인은 유지되고 다른 기기의 기존 로그인은 만료됩니다.
          </DialogDescription>
        </DialogHeader>
        <PasswordChangeForm key={formKey} onDone={() => setOpen(false)} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
