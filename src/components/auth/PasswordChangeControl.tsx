"use client";

import { useActionState, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { AccountDialogHandle } from "@/components/auth/LocalDraftManager";
import { KeyRound } from "lucide-react";
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, AUTH_SUBMIT_CLASS } from "@/components/auth/LoginSubmitButton";
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

/** change: 계정 메뉴의 자발적 변경(대화상자), required: 임시 비밀번호 로그인 뒤 필수 변경(전체 화면). */
export type PasswordChangeVariant = "change" | "required";

// 대화상자 하단 버튼: 좁은 화면(아래 시트)은 줄을 채우는 44px, 넓은 화면은 오른쪽 정렬 32px(캔버스 AccountDialogs).
const DIALOG_FOOTER_CLASS = "flex flex-wrap gap-2 md:justify-end";
const DIALOG_BUTTON_CLASS = "h-11 flex-auto rounded-touch text-body md:h-8 md:flex-none md:rounded-md md:text-ui";

/** 입력에 연결할 설명 id를 오류 먼저, 도움말 다음 순서로 잇는다. */
function describedBy(...ids: (string | null)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

export function PasswordChangeForm({
  variant = "change",
  onDone,
  onCancel,
  onBusyChange,
}: {
  variant?: PasswordChangeVariant;
  onDone: () => void;
  /** 대화상자의 취소 버튼. 없으면 취소 버튼을 그리지 않는다. */
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const required = variant === "required";
  const baseId = useId();
  const labels: Record<ChangePasswordField, string> = required
    ? { ...FIELD_LABELS, currentPassword: "임시 비밀번호" }
    : FIELD_LABELS;
  const doneButtonRef = useRef<HTMLButtonElement>(null);
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
    onBusyChange?.(pending);
  }, [onBusyChange, pending]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // 입력 form이 사라지므로 결과 화면의 다음 행동으로 초점을 옮긴다.
  useEffect(() => {
    if (state.success) doneButtonRef.current?.focus();
  }, [state.success]);

  // 필수 변경은 새 로그인이 발급되면 결과 화면 없이 바로 포탈로 이동한다. 서버도 다시 그린
  // 설정 화면에서 같은 이동을 하므로, 어느 쪽이 먼저든 한 번만 요청한다.
  const hasEnteredPortalRef = useRef(false);
  useEffect(() => {
    if (!required || !state.success || state.signInRequired || hasEnteredPortalRef.current) return;
    hasEnteredPortalRef.current = true;
    onDone();
  }, [required, state, onDone]);

  if (state.success) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md bg-success-muted px-3 py-2.5 text-ui text-success">
          {state.signInRequired
            ? "비밀번호를 변경했습니다. 이 기기에서도 새 비밀번호로 다시 로그인해 주세요."
            : required
              ? "새 비밀번호를 저장했습니다. 포탈로 이동합니다."
              : "비밀번호를 변경했습니다. 다른 기기의 기존 로그인은 다음 요청부터 만료됩니다."}
        </p>
        {state.signInRequired ? (
          required ? (
            <Button ref={doneButtonRef} type="button" size="touch" className={AUTH_SUBMIT_CLASS} onClick={() => window.location.assign(new URL("/login", window.location.origin))}>
              로그인 화면으로 이동
            </Button>
          ) : (
            <div className={DIALOG_FOOTER_CLASS}>
              <Button ref={doneButtonRef} type="button" className={DIALOG_BUTTON_CLASS} onClick={() => window.location.assign(new URL("/login", window.location.origin))}>
                로그인 화면으로 이동
              </Button>
            </div>
          )
        ) : required ? null : (
          <div className={DIALOG_FOOTER_CLASS}>
            <Button ref={doneButtonRef} type="button" variant="outline" className={DIALOG_BUTTON_CLASS} onClick={onDone}>
              닫기
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
      {(Object.keys(labels) as ChangePasswordField[]).map((field) => {
        const inputId = `${baseId}-${field}`;
        const helpId = `${inputId}-help`;
        const invalid = !pending && state.field === field;
        return (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className={required ? AUTH_LABEL_CLASS : "text-body text-secondary-foreground md:text-xs"}>
              {labels[field]}
            </label>
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
              className={required ? AUTH_INPUT_CLASS : undefined}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy(invalid ? errorId : null, field === "newPassword" ? helpId : null)}
            />
            {field === "newPassword" ? (
              <p id={helpId} className="text-xs text-muted-foreground">
                {PASSWORD_MIN_LENGTH}자 이상으로 입력해 주세요.
              </p>
            ) : null}
            {invalid && state.error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {state.error}
              </p>
            ) : null}
          </div>
        );
      })}
      {state.error && !pending && !state.field ? (
        <p id={errorId} role="alert" className="rounded-md bg-destructive-muted px-3 py-2.5 text-ui text-destructive">
          {state.error}
        </p>
      ) : null}
      {required ? (
        <Button type="submit" size="touch" className={AUTH_SUBMIT_CLASS} disabled={pending}>
          {pending ? "저장 중..." : "새 비밀번호 저장"}
        </Button>
      ) : (
        <div className={DIALOG_FOOTER_CLASS}>
          {onCancel ? (
            <Button type="button" variant="outline" className={DIALOG_BUTTON_CLASS} disabled={pending} onClick={onCancel}>
              취소
            </Button>
          ) : null}
          <Button type="submit" className={DIALOG_BUTTON_CLASS} disabled={pending}>
            {pending ? "변경 중..." : "비밀번호 변경"}
          </Button>
        </div>
      )}
    </form>
  );
}

/** 계정 메뉴의 본인 비밀번호 변경(캔버스 AccountDialogs "비밀번호 변경"). 변경 중에는 대화상자를 닫지 못하게 한다. */
export function PasswordChangeControl({
  controlRef,
  hideTrigger = false,
}: {
  controlRef?: Ref<AccountDialogHandle>;
  hideTrigger?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const handleOpenChange = (nextOpen: boolean) => {
    if (busy) return;
    setOpen(nextOpen);
    // 닫았다 다시 열면 이전 입력과 결과 없이 새 form으로 시작한다.
    if (!nextOpen) setFormKey((key) => key + 1);
  };
  useImperativeHandle(controlRef, () => ({ open: () => handleOpenChange(true) }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : <DialogTrigger asChild>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-touch text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:size-8 md:rounded-md"
          aria-label="비밀번호 변경"
          title="비밀번호 변경"
        >
          <KeyRound className="size-4" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </DialogTrigger>}
      <DialogContent dismissible={!busy}>
        <DialogHeader>
          <DialogTitle>비밀번호 변경</DialogTitle>
          <DialogDescription>
            현재 비밀번호를 확인한 뒤 바꿉니다. 이 기기의 로그인은 유지되고 다른 기기의 기존 로그인은 만료됩니다.
          </DialogDescription>
        </DialogHeader>
        <PasswordChangeForm key={formKey} onDone={() => setOpen(false)} onCancel={() => handleOpenChange(false)} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
