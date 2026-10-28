"use client";

import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, AUTH_SUBMIT_CLASS } from "@/components/auth/LoginSubmitButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  completeInvite,
  getInviteStatus,
  type CompleteInviteField,
  type CompleteInviteState,
} from "@/lib/actions/invite";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

type InviteView =
  | { kind: "checking" }
  | { kind: "unusable"; reason: "invalid" | "expired" | "limited" | "failed"; message?: string }
  | { kind: "valid"; token: string; displayName: string | null; email: string };

const UNUSABLE_COPY: Record<"invalid" | "expired" | "limited" | "failed", { title: string; body: string }> = {
  invalid: {
    title: "가입 링크를 열 수 없습니다",
    body: "링크가 올바르지 않거나 이미 사용됐습니다. 이미 가입했다면 로그인해 주세요. 새 링크가 필요하면 Stann에게 요청해 주세요.",
  },
  expired: {
    title: "가입 링크가 만료됐습니다",
    body: "가입 링크는 발급 뒤 7일 동안 쓸 수 있습니다. Stann에게 새 링크를 요청해 주세요.",
  },
  limited: { title: "잠시 뒤 다시 열어 주세요", body: "" },
  failed: { title: "가입 링크를 확인하지 못했습니다", body: "네트워크 연결을 확인한 뒤 이 페이지를 새로고침해 주세요." },
};

const AUTH_HEADING_CLASS = "break-words text-2xl font-semibold tracking-display text-foreground focus:outline-none";
const AUTH_LEAD_CLASS = "text-md leading-6 text-secondary-foreground md:text-body md:leading-[22px]";

/** 입력에 연결할 설명 id를 오류 먼저, 도움말 다음 순서로 잇는다. */
function describedBy(...ids: (string | null)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

const FIELD_LABELS: Record<CompleteInviteField, string> = {
  newPassword: "비밀번호",
  confirmPassword: "비밀번호 확인",
};

function InviteForm({
  view,
  onUnusable,
  onSignedIn,
}: {
  view: Extract<InviteView, { kind: "valid" }>;
  onUnusable: (reason: "invalid" | "expired", message: string) => void;
  onSignedIn: () => void;
}) {
  const baseId = useId();
  const [fields, setFields] = useState<Record<CompleteInviteField, string>>({ newPassword: "", confirmPassword: "" });
  const inputRefs = useRef<Partial<Record<CompleteInviteField, HTMLInputElement | null>>>({});
  const hasSignedInRef = useRef(false);
  const [state, action, pending] = useActionState<CompleteInviteState, FormData>(
    async (previous, data) => {
      try {
        const result = await completeInvite(previous, data);
        if (result.success) setFields({ newPassword: "", confirmPassword: "" });
        if (result.linkUnusable && result.error) onUnusable(result.linkUnusable, result.error);
        return result;
      } catch {
        return { error: "가입 결과를 확인하지 못했습니다. 정한 비밀번호로 로그인되는지 확인해 주세요." };
      }
    },
    {},
  );
  const errorId = `${baseId}-error`;

  useEffect(() => {
    if (state.field) inputRefs.current[state.field]?.focus();
  }, [state]);

  useEffect(() => {
    if (!state.success || state.signInRequired || hasSignedInRef.current) return;
    hasSignedInRef.current = true;
    onSignedIn();
  }, [state, onSignedIn]);

  if (state.success) {
    return state.signInRequired ? (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md bg-success-muted px-3 py-2.5 text-ui text-success">
          가입을 마쳤습니다. 정한 비밀번호로 로그인해 주세요.
        </p>
        <Button asChild size="touch" className={AUTH_SUBMIT_CLASS}><Link href="/login">로그인 화면으로 이동</Link></Button>
      </div>
    ) : (
      <p role="status" className="rounded-md bg-success-muted px-3 py-2.5 text-ui text-success">
        가입을 마쳤습니다. 포탈로 이동합니다.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-0.5 rounded-touch bg-sidebar px-3.5 py-3 md:min-h-10 md:flex-row md:items-center md:gap-0 md:rounded-md md:px-3 md:py-2">
        <span className="text-xs text-muted-foreground md:w-[88px] md:shrink-0 md:text-ui">로그인 이메일</span>
        <span className="min-w-0 break-all font-mono text-ui text-foreground md:text-xs">{view.email}</span>
      </div>
      <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
        <input type="hidden" name="token" value={view.token} />
        {(Object.keys(FIELD_LABELS) as CompleteInviteField[]).map((field) => {
          const inputId = `${baseId}-${field}`;
          const invalid = !pending && state.field === field;
          return (
            <div key={field} className="flex flex-col gap-1.5">
              <label htmlFor={inputId} className={AUTH_LABEL_CLASS}>{FIELD_LABELS[field]}</label>
              <Input
                ref={(element) => { inputRefs.current[field] = element; }}
                id={inputId}
                name={field}
                type="password"
                required
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                value={fields[field]}
                onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))}
                disabled={pending}
                className={AUTH_INPUT_CLASS}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy(invalid ? errorId : null, field === "newPassword" ? `${inputId}-help` : null)}
              />
              {field === "newPassword" ? (
                <p id={`${inputId}-help`} className="text-xs text-muted-foreground">{PASSWORD_MIN_LENGTH}자 이상으로 입력해 주세요.</p>
              ) : null}
              {invalid && state.error ? (
                <p id={errorId} role="alert" className="text-xs text-destructive">{state.error}</p>
              ) : null}
            </div>
          );
        })}
        {state.error && !pending && !state.field ? (
          <p id={errorId} role="alert" className="rounded-md bg-destructive-muted px-3 py-2.5 text-ui text-destructive">{state.error}</p>
        ) : null}
        <Button type="submit" size="touch" className={AUTH_SUBMIT_CLASS} disabled={pending}>{pending ? "가입 중..." : "가입 완료"}</Button>
      </form>
    </>
  );
}

function subscribeToNothing(): () => void {
  return () => {};
}

function readNoTokenOnServer(): string | null {
  return null;
}

/** 잘못 인코딩된 주소는 빈 token으로 보고 "사용할 수 없는 링크"로 안내한다. */
function readInviteTokenFromHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

/**
 * 가입 링크(`/invite#<token>`)의 token을 읽어 확인하고 학생이 직접 비밀번호를 정하게 한다.
 * token은 주소의 `#` 뒤에만 있어 서버 요청 주소에 남지 않고, server action 본문으로만 보낸다.
 */
export function InviteSignup({
  readToken = readInviteTokenFromHash,
  // 새 session cookie를 proxy와 layout이 처음부터 읽도록 client 라우팅이 아닌 전체 문서 이동을 쓴다.
  onSignedIn = () => window.location.assign(new URL("/dashboard", window.location.origin)),
}: {
  readToken?: () => string;
  onSignedIn?: () => void;
}) {
  // 주소의 `#` token은 브라우저에서만 읽을 수 있다. 서버 렌더와 hydration 동안에는 null(확인 중)로 두어
  // 화면이 어긋나지 않게 하고, 링크는 이 화면을 여는 순간의 주소로 한 번만 확인한다.
  const currentToken = useSyncExternalStore(subscribeToNothing, readToken, readNoTokenOnServer);
  const [token, setToken] = useState<string | null>(null);
  if (token === null && currentToken !== null) setToken(currentToken);
  const [checkedView, setView] = useState<InviteView>({ kind: "checking" });
  const view: InviteView = token === "" ? { kind: "unusable", reason: "invalid" } : checkedView;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getInviteStatus(token)
      .then((status) => {
        if (cancelled) return;
        if (status.status === "valid") setView({ kind: "valid", token, displayName: status.displayName, email: status.email });
        else if (status.status === "limited") setView({ kind: "unusable", reason: "limited", message: status.error });
        else setView({ kind: "unusable", reason: status.status });
      })
      .catch(() => {
        if (!cancelled) setView({ kind: "unusable", reason: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (view.kind !== "checking") headingRef.current?.focus();
  }, [view.kind]);

  if (view.kind === "checking") {
    return <p role="status" className="text-md leading-6 text-muted-foreground md:text-body md:leading-[22px]">가입 링크를 확인하고 있습니다…</p>;
  }

  if (view.kind === "unusable") {
    const copy = UNUSABLE_COPY[view.reason];
    return (
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-1.5">
          <h1 ref={headingRef} tabIndex={-1} className={AUTH_HEADING_CLASS}>{copy.title}</h1>
          <p className={AUTH_LEAD_CLASS}>{view.message ?? copy.body}</p>
        </div>
        <Button asChild variant="outline" size="touch" className={AUTH_SUBMIT_CLASS}><Link href="/login">로그인 화면으로 이동</Link></Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-1.5">
        <h1 ref={headingRef} tabIndex={-1} className={AUTH_HEADING_CLASS}>
          {view.displayName ? `${view.displayName}님, 환영합니다` : "가입을 환영합니다"}
        </h1>
        <p className={AUTH_LEAD_CLASS}>로그인에 쓸 비밀번호를 정하면 바로 포탈을 쓸 수 있습니다.</p>
      </div>
      <InviteForm
        view={view}
        onUnusable={(reason, message) => setView({ kind: "unusable", reason, message })}
        onSignedIn={onSignedIn}
      />
    </div>
  );
}
