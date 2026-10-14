/**
 * @file src/app/dashboard/admin/students/new/page.tsx
 * @description 학생 계정 생성 페이지 (Admin 전용).
 * 관리자는 이름·이메일만 입력하고 가입 링크를 받는다. 비밀번호는 학생이 링크에서 직접 정한다.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { OneTimeSecret } from "@/components/admin/OneTimeSecret";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStudent, type CreateStudentState } from "@/lib/actions/students";

const initialState: CreateStudentState = {};

function CreatedStudent({
  created,
  onCreateAnother,
}: {
  created: NonNullable<CreateStudentState["created"]>;
  onCreateAnother: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}${created.invitePath}` : created.invitePath;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4" aria-labelledby="created-student-heading">
      <h2 id="created-student-heading" ref={headingRef} tabIndex={-1} className="break-words text-lg font-semibold focus:outline-none">
        {created.displayName} 학생 계정을 만들었습니다
      </h2>
      <p className="text-sm text-muted-foreground">
        아래 가입 링크를 학생에게 전달해 주세요. 학생이 링크에서 직접 비밀번호를 정하면 로그인할 수 있습니다.
      </p>
      <OneTimeSecret
        value={inviteUrl}
        notice="이 화면을 벗어나면 다시 볼 수 없습니다. 링크는 7일 동안 한 번 쓸 수 있고, 학생 상세에서 다시 발급할 수 있습니다."
      />
      <div className="flex flex-wrap gap-3 pt-1">
        <Button asChild className="gap-2">
          <Link href={`/dashboard/admin/students/${encodeURIComponent(created.studentId)}?tab=overview`}>학생 상세로 이동</Link>
        </Button>
        <Button type="button" variant="outline" onClick={onCreateAnother}>
          다른 학생 추가
        </Button>
      </div>
    </section>
  );
}

function NewStudentForm({ onCreated }: { onCreated: (created: NonNullable<CreateStudentState["created"]>) => void }) {
  // form action은 결과와 무관하게 uncontrolled 입력을 비우므로 실패 뒤에도 값을 유지하도록 제어한다.
  const [fields, setFields] = useState({ displayName: "", email: "" });
  const [state, action, isPending] = useActionState<CreateStudentState, FormData>(
    async (previous, data) => {
      try {
        const result = await createStudent(previous, data);
        if (result.created) onCreated(result.created);
        return result;
      } catch {
        return { error: "계정을 만들지 못했습니다. 다시 시도해 주세요." };
      }
    },
    initialState,
  );
  const update = (key: keyof typeof fields) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form action={action} className="space-y-5" aria-busy={isPending}>
      {state?.error && !isPending && (
        <div id="new-student-error" role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="displayName" className="text-sm font-medium text-foreground">
          이름 <span className="text-destructive">*</span>
        </label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          placeholder="예: 김민준"
          required
          maxLength={60}
          autoFocus
          value={fields.displayName}
          onChange={update("displayName")}
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          이메일 <span className="text-destructive">*</span>
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="student@example.com"
          required
          autoComplete="off"
          value={fields.email}
          onChange={update("email")}
          disabled={isPending}
          aria-describedby="email-help"
        />
        <p id="email-help" className="text-xs text-muted-foreground">
          학생이 로그인할 때 쓰는 주소입니다. 계정을 만들면 가입 링크가 나오고, 학생이 그 링크에서 비밀번호를 정합니다.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending} className="gap-2 flex-1">
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          {isPending ? "생성 중..." : "계정 생성"}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/admin?section=students" aria-disabled={isPending} tabIndex={isPending ? -1 : undefined}>취소</Link>
        </Button>
      </div>
    </form>
  );
}

export default function NewStudentPage() {
  const [created, setCreated] = useState<CreateStudentState["created"]>();
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <Link
          href="/dashboard/admin?section=students"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          학생 목록으로 돌아가기
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">
          학생 계정 생성
        </h1>
        <p className="text-sm text-muted-foreground">
          새 수강생 계정을 만들고 가입 링크를 발급합니다.
        </p>
      </div>

      {created ? (
        <CreatedStudent
          created={created}
          onCreateAnother={() => {
            setCreated(undefined);
            setFormKey((key) => key + 1);
          }}
        />
      ) : (
        <NewStudentForm key={formKey} onCreated={setCreated} />
      )}
    </div>
  );
}
