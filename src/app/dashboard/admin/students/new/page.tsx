/**
 * @file src/app/dashboard/admin/students/new/page.tsx
 * @description 학생 계정 생성 페이지 (Admin 전용, AdminStudentNew·AdminStudentCreated 보드).
 * 관리자는 이름·이메일만 입력하고 가입 링크를 받는다. 비밀번호는 학생이 링크에서 직접 정한다.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft } from "lucide-react";
import { OneTimeSecret } from "@/components/admin/OneTimeSecret";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStudent, type CreateStudentState } from "@/lib/actions/students";

const initialState: CreateStudentState = {};
const STUDENTS_HREF = "/dashboard/admin?section=students";
/** 이 화면의 버튼: 넓은 화면 36px·r6, 좁은 화면 44px·r8. */
const PAGE_BUTTON_CLASS = "h-11 rounded-touch text-body md:h-9 md:rounded-md md:text-ui";
const FIELD_LABEL_CLASS = "text-ui font-medium text-secondary-foreground";

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
    <section className="flex flex-col gap-4" aria-labelledby="created-student-heading">
      <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-touch bg-muted text-foreground">
        <Check className="size-[18px]" strokeWidth={1.8} />
      </span>
      <h1
        id="created-student-heading"
        ref={headingRef}
        tabIndex={-1}
        className="break-words text-xl font-semibold tracking-display text-foreground focus:outline-none md:text-2xl"
      >
        {created.displayName} 학생 계정을 만들었습니다
      </h1>
      <OneTimeSecret
        label="가입 링크"
        value={inviteUrl}
        notice="이 화면을 벗어나면 다시 볼 수 없습니다. 링크는 7일 동안 한 번 쓸 수 있고, 학생 상세에서 다시 발급할 수 있습니다."
      />
      <div className="flex flex-wrap gap-2 pt-2">
        <Link
          href={`/dashboard/admin/students/${encodeURIComponent(created.studentId)}?tab=overview`}
          className={buttonClassName({ variant: "outline", className: PAGE_BUTTON_CLASS })}
        >
          학생 상세로 이동
        </Link>
        <Button type="button" variant="ghost" className={PAGE_BUTTON_CLASS} onClick={onCreateAnother}>
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
    <form action={action} className="flex flex-col gap-5" aria-busy={isPending}>
      {state?.error && !isPending && (
        <div id="new-student-error" role="alert" className="rounded-touch bg-destructive-muted px-3.5 py-3 text-ui text-destructive">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="displayName" className={FIELD_LABEL_CLASS}>이름</label>
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
          className="md:h-10"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={FIELD_LABEL_CLASS}>이메일</label>
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
          className="md:h-10"
        />
        <p id="email-help" className="text-xs leading-[18px] text-muted-foreground">
          학생이 로그인할 때 쓰는 주소입니다. 계정을 만들면 가입 링크가 나오고, 학생이 그 링크에서 비밀번호를 정합니다.
        </p>
      </div>

      <div className="flex justify-end gap-2 border-t border-muted pt-2 max-md:[&>*]:flex-1">
        <Link
          href={STUDENTS_HREF}
          aria-disabled={isPending}
          tabIndex={isPending ? -1 : undefined}
          className={buttonClassName({ variant: "outline", className: PAGE_BUTTON_CLASS })}
        >
          취소
        </Link>
        <Button type="submit" disabled={isPending} className={`${PAGE_BUTTON_CLASS} md:px-4`}>
          {isPending ? "생성 중..." : "계정 생성"}
        </Button>
      </div>
    </form>
  );
}

export default function NewStudentPage() {
  const [created, setCreated] = useState<CreateStudentState["created"]>();
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <div className="flex max-w-[560px] flex-col gap-7">
        <Link
          href={STUDENTS_HREF}
          className="-ml-1 hidden h-8 items-center gap-1.5 self-start rounded-md pl-1 pr-2 text-ui text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
        >
          <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          학생 목록으로 돌아가기
        </Link>

        {created ? (
          <CreatedStudent
            created={created}
            onCreateAnother={() => {
              setCreated(undefined);
              setFormKey((key) => key + 1);
            }}
          />
        ) : (
          <>
            <header className="flex flex-col gap-1.5">
              <h1 className="text-mobile-title font-semibold tracking-display text-foreground md:text-display">학생 계정 생성</h1>
              <p className="text-body text-secondary-foreground">새 수강생 계정을 만들고 가입 링크를 발급합니다.</p>
            </header>
            <NewStudentForm key={formKey} onCreated={setCreated} />
          </>
        )}
      </div>
    </div>
  );
}
