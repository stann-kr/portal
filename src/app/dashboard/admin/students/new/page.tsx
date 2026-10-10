/**
 * @file src/app/dashboard/admin/students/new/page.tsx
 * @description 학생 계정 생성 페이지 (Admin 전용).
 * FormData 기반, useActionState로 에러 피드백 처리.
 */
"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStudent, type CreateStudentState } from "@/lib/actions/students";

const initialState: CreateStudentState = {};

export default function NewStudentPage() {
  // form action은 결과와 무관하게 uncontrolled 입력을 비우므로 실패 뒤에도 값을 유지하도록 제어한다.
  const [fields, setFields] = useState({ displayName: "", email: "", password: "" });
  const [state, action, isPending] = useActionState(
    createStudent,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const update = (key: keyof typeof fields) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-6 sm:px-6">
      {/* 헤더 */}
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
          새 수강생 계정을 만들고 초기 비밀번호를 설정합니다.
        </p>
      </div>

      {/* 폼 */}
      <form action={action} className="space-y-5" aria-busy={isPending}>
        {/* 전역 에러 */}
        {state?.error && !isPending && (
          <div id="new-student-error" role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {state.error}
          </div>
        )}

        {/* 이름 */}
        <div className="space-y-1.5">
          <label
            htmlFor="displayName"
            className="text-sm font-medium text-foreground"
          >
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

        {/* 이메일 */}
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="text-sm font-medium text-foreground"
          >
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
          />
        </div>

        {/* 비밀번호 */}
        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="text-sm font-medium text-foreground"
          >
            초기 비밀번호 <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="8자 이상"
              required
              minLength={8}
              autoComplete="new-password"
              value={fields.password}
              onChange={update("password")}
              disabled={isPending}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              aria-pressed={showPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            학생에게 초기 비밀번호를 안전하게 전달하세요. 학생은 로그인한 뒤 사이드 레일의 열쇠 버튼에서 직접 바꿀 수 있습니다.
          </p>
        </div>

        {/* 버튼 */}
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
    </div>
  );
}
