/**
 * @file src/app/dashboard/admin/students/new/page.tsx
 * @description 학생 계정 생성 페이지 (Admin 전용).
 * FormData 기반, useActionState로 에러 피드백 처리.
 */
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStudent, type CreateStudentState } from "@/lib/actions/students";
import { useState } from "react";

const initialState: CreateStudentState = {};

export default function NewStudentPage() {
  const [state, action, isPending] = useActionState(
    createStudent,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-6 sm:px-6">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href="/dashboard/admin"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          관리자 포털
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">
          학생 계정 생성
        </h1>
        <p className="text-sm text-muted-foreground">
          새 수강생 계정을 만들고 초기 비밀번호를 설정합니다.
        </p>
      </div>

      {/* 폼 */}
      <form action={action} className="space-y-5">
        {/* 전역 에러 */}
        {state?.error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
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
            autoFocus
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
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            학생에게 초기 비밀번호를 안전하게 전달하세요.
          </p>
        </div>

        {/* 버튼 */}
        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={isPending} className="gap-2 flex-1">
            <UserPlus className="w-4 h-4" />
            {isPending ? "생성 중..." : "계정 생성"}
          </Button>
          <Button variant="outline" asChild disabled={isPending}>
            <Link href="/dashboard/admin">취소</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
