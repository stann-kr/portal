/**
 * @file src/components/qna/AttachmentField.tsx
 * @description Q&A 작성 폼용 첨부 파일 필드(캔버스 QnaNew·MobileQnaNew 첨부 줄, QnaThread·MobileQnaThread 답글 상자 바닥 줄).
 * FileUploader로 R2 업로드 → 인증형 delivery URL을 hidden input으로 전송.
 * 업로드 완료 시 파일 칩 + 제거 버튼 노출.
 */
"use client";

import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import {
  FileUploader,
  type CompletedMediaUpload,
  type FileUploaderProps,
} from "@/components/upload/FileUploader";
import { abandonMediaUpload } from "@/lib/actions/upload";
import { cn } from "@/lib/utils";

interface AttachmentFieldProps {
  /** 현재 첨부 URL (없으면 빈 문자열) */
  value: string;
  mediaObjectId: string;
  draftOperationId: string;
  onChange: (upload: CompletedMediaUpload | null) => void;
  disabled?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
  /**
   * 선택 버튼 모양(FileUploader `trigger`). composer는 답글 상자 바닥 줄의 클립 버튼이고,
   * 고른 파일은 QnaThread 보드의 첨부 링크처럼 선 있는 칩으로 보인다.
   */
  trigger?: FileUploaderProps["trigger"];
  /**
   * 업로드 실패 안내를 상위 화면이 직접 그릴 때 받는다(좁은 바닥 줄처럼 안내를 아래에 둘 자리가 없을 때).
   * 주면 이 필드는 안내 문단을 그리지 않고, 실패 시 메시지를, 다시 고르거나 성공하면 빈 문자열을 알린다.
   */
  onErrorChange?: (message: string) => void;
}

export function AttachmentField({
  value,
  mediaObjectId,
  draftOperationId,
  onChange,
  disabled,
  onUploadingChange,
  trigger,
  onErrorChange,
}: AttachmentFieldProps) {
  const [uploadError, setUploadError] = useState("");
  const isComposer = trigger === "composer";
  const reportError = (message: string) => {
    setUploadError(message);
    onErrorChange?.(message);
  };

  return (
    <div className={cn("flex flex-col gap-2", isComposer && "min-w-0")}>
      {/* 서버 액션 전송용 hidden 필드 */}
      <input type="hidden" name="attachmentUrl" value={value} />
      <input type="hidden" name="attachmentObjectId" value={mediaObjectId} />

      {value ? (
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex max-w-full items-center",
              isComposer
                ? "h-11 gap-1.5 rounded-touch border border-border pl-3 text-ui md:h-7 md:rounded-md md:pl-2.5 md:pr-0.5 md:text-xs"
                : "h-11 gap-0.5 rounded-touch bg-muted pl-3 text-ui md:h-8 md:gap-1 md:rounded-md md:pl-2.5 md:pr-1 md:text-xs",
            )}
          >
            <Paperclip
              className={cn("shrink-0 text-secondary-foreground", isComposer ? "size-3.5 md:size-[13px]" : "size-3.5")}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span className={cn("truncate text-foreground", !isComposer && "ml-1")}>{value.split("/").pop()}</span>
            <button
              type="button"
              onClick={() => {
                const abandonedId = mediaObjectId;
                onChange(null);
                if (abandonedId) {
                  void abandonMediaUpload(abandonedId).catch(() => undefined);
                }
              }}
              disabled={disabled}
              aria-label="첨부 제거"
              className="flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:size-6 md:rounded-sm"
            >
              <X className="size-3.5 md:size-3" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : (
        <FileUploader
          purpose="QNA_ATTACHMENT"
          draftOperationId={draftOperationId}
          label="파일 첨부"
          disabled={disabled}
          trigger={trigger}
          onUploadingChange={(isUploading) => {
            if (isUploading) reportError("");
            onUploadingChange?.(isUploading);
          }}
          onUploadComplete={(upload) => {
            reportError("");
            onChange(upload);
          }}
          onError={reportError}
        />
      )}
      {uploadError && !onErrorChange ? (
        <p role="alert" className="text-ui text-destructive">
          파일을 업로드하지 못했습니다. {uploadError}
        </p>
      ) : null}
    </div>
  );
}
