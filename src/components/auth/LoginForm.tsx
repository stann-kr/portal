"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, LoginSubmitButton } from "@/components/auth/LoginSubmitButton";
import { loginWithCredentials, type LoginState } from "@/lib/actions/session";

const INITIAL_LOGIN_STATE: LoginState = {};

/**
 * 실패해도 이메일과 로그인 뒤 이동할 주소를 유지하고, 다시 입력할 비밀번호로 초점을 옮긴다.
 * React form action은 uncontrolled 입력을 비우므로 이메일만 제어한다.
 */
export function LoginForm({
  callbackUrl,
  initialError,
}: {
  callbackUrl?: string;
  initialError?: string | null;
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginWithCredentials, INITIAL_LOGIN_STATE);
  // JS 없이 제출된 경우에도 서버가 돌려준 이메일로 다시 채운다.
  const [email, setEmail] = useState(() => state.email ?? "");
  const passwordRef = useRef<HTMLInputElement>(null);
  const hasResult = state !== INITIAL_LOGIN_STATE;
  const errorMessage = pending ? null : hasResult ? state.error : initialError;

  useEffect(() => {
    if (state.error) passwordRef.current?.focus();
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
      {errorMessage ? (
        <div id="login-error" role="alert" className="rounded-md bg-destructive-muted px-3 py-2.5 text-ui text-destructive">
          {errorMessage}
        </div>
      ) : null}
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={AUTH_LABEL_CLASS}>
          이메일
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@example.com"
          className={AUTH_INPUT_CLASS}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={errorMessage ? "login-error" : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={AUTH_LABEL_CLASS}>
          비밀번호
        </label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={AUTH_INPUT_CLASS}
          aria-describedby={errorMessage ? "login-error" : undefined}
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-body text-foreground md:min-h-0 md:text-ui">
        <input
          type="checkbox"
          name="remember"
          value="on"
          defaultChecked
          className="size-4 rounded-sm border-faint accent-primary"
          aria-describedby="login-remember-hint"
        />
        로그인 유지
      </label>
      <p id="login-remember-hint" className="-mt-2 text-xs text-muted-foreground">
        끄면 브라우저를 닫을 때 로그아웃됩니다. 함께 쓰는 기기에서는 꺼 주세요.
      </p>

      <LoginSubmitButton />
    </form>
  );
}
