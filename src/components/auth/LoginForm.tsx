"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { LoginSubmitButton } from "@/components/auth/LoginSubmitButton";
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
    <>
      {errorMessage ? (
        <div id="login-error" role="alert" className="mt-5 rounded-md border border-destructive/20 bg-destructive-muted px-4 py-3 text-sm font-medium text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <form action={action} className="mt-6 space-y-4" aria-busy={pending}>
        {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            이메일
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="name@example.com"
            className="h-10"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={errorMessage ? "login-error" : undefined}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            비밀번호
          </label>
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="h-10"
            aria-describedby={errorMessage ? "login-error" : undefined}
          />
        </div>

        <LoginSubmitButton />
      </form>
    </>
  );
}
