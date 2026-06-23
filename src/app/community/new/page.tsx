/**
 * @file src/app/community/new/page.tsx
 * @description 게시물 작성 페이지 — Phase 3 고도화.
 * boardType(ANNOUNCEMENT/GENERAL/FEEDBACK)별 UI 분기:
 * - ANNOUNCEMENT: isPinned 체크박스
 * - GENERAL: 채널(카테고리) 선택
 * - FEEDBACK: R2 오디오 파일 업로드
 */
"use client";

import { useActionState, useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, Megaphone, MessageSquare, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPost, type CreatePostState } from "@/lib/actions/posts";
import dynamic from "next/dynamic";

const FullEditor = dynamic(
  () => import("@/components/editor/FullEditor").then((m) => ({ default: m.FullEditor })),
  { ssr: false }
);
import { getCategories } from "@/lib/actions/categories";
import { FileUploader } from "@/components/upload/FileUploader";

type BoardType = "ANNOUNCEMENT" | "GENERAL" | "FEEDBACK";

const BOARD_TYPES = [
  { value: "GENERAL" as const, label: "자유", icon: MessageSquare },
  { value: "ANNOUNCEMENT" as const, label: "공지", icon: Megaphone },
  { value: "FEEDBACK" as const, label: "믹스셋", icon: Music2 },
] as const;

function NewPostForm() {
  const searchParams = useSearchParams();
  const defaultBoardType = (searchParams?.get("boardType") as BoardType) ?? "GENERAL";
  const defaultCategory = searchParams?.get("category") ?? "general";

  const [state, action, isPending] = useActionState<CreatePostState, FormData>(
    createPost,
    {},
  );

  const [boardType, setBoardType] = useState<BoardType>(defaultBoardType);
  const [contentHtml, setContentHtml] = useState("");
  const [categories, setCategories] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-6 px-4">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href="/community"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Community
        </Link>
        <h1 className="text-2xl font-semibold mt-2">새 게시물</h1>
      </div>

      {/* 폼 */}
      <form action={action} className="space-y-5">
        {/* 숨김 필드 */}
        <input type="hidden" name="boardType" value={boardType} />
        <input type="hidden" name="contentHtml" value={contentHtml} />
        <input type="hidden" name="mediaUrl" value={mediaUrl} />

        {/* 에러 */}
        {state?.error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {state.error}
          </div>
        )}

        {/* 게시판 유형 선택 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">게시판 유형</label>
          <div className="flex gap-2">
            {BOARD_TYPES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setBoardType(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  boardType === value
                    ? "border-foreground text-foreground font-medium"
                    : "border-border text-muted-foreground hover:border-foreground/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* GENERAL: 채널 선택 */}
        {boardType === "GENERAL" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">채널</label>
            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => (
                <label key={cat.id} className="cursor-pointer">
                  <input
                    type="radio"
                    name="category"
                    value={cat.slug}
                    defaultChecked={cat.slug === defaultCategory}
                    className="sr-only peer"
                    disabled={isPending}
                  />
                  <span className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground peer-checked:border-foreground peer-checked:text-foreground peer-checked:font-medium transition-colors hover:border-foreground/50">
                    # {cat.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ANNOUNCEMENT: isPinned 체크박스 */}
        {boardType === "ANNOUNCEMENT" && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPinned"
              name="isPinned"
              value="on"
              className="w-4 h-4 rounded border-border accent-primary"
              disabled={isPending}
            />
            <label htmlFor="isPinned" className="text-sm font-medium cursor-pointer">
              공지 상단 고정
            </label>
          </div>
        )}

        {/* FEEDBACK: 오디오 파일 업로드 */}
        {boardType === "FEEDBACK" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              오디오 파일 <span className="text-muted-foreground">(선택)</span>
            </label>
            {mediaUrl ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                <Music2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">
                  업로드 완료
                </span>
                <button
                  type="button"
                  onClick={() => setMediaUrl("")}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  제거
                </button>
              </div>
            ) : (
              <FileUploader
                accept="audio/*"
                prefix="community/audio/"
                label="오디오 파일 선택 (MP3, WAV, FLAC)"
                onUploadComplete={(url) => {
                  setMediaUrl(url);
                  setUploadError("");
                }}
                onError={(msg) => setUploadError(msg)}
                disabled={isPending}
              />
            )}
            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
          </div>
        )}

        {/* 제목 */}
        <div className="space-y-1.5">
          <label htmlFor="title" className="text-sm font-medium">
            제목 <span className="text-destructive">*</span>
          </label>
          <Input
            id="title"
            name="title"
            type="text"
            placeholder="게시물 제목"
            required
            disabled={isPending}
          />
        </div>

        {/* 내용 */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            내용 <span className="text-destructive">*</span>
          </label>
          <FullEditor
            onChange={setContentHtml}
            placeholder="게시물 내용을 작성하세요..."
            disabled={isPending}
          />
        </div>

        {/* 버튼 */}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isPending}
            className="gap-2 flex-1"
          >
            <Send className="w-4 h-4" />
            {isPending ? "게시 중..." : "게시하기"}
          </Button>
          <Button variant="outline" asChild disabled={isPending}>
            <Link href="/community">취소</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewPostPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto py-6 space-y-6 text-center text-muted-foreground">
          로딩 중...
        </div>
      }
    >
      <NewPostForm />
    </Suspense>
  );
}
