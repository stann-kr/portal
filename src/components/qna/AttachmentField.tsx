/**
 * @file src/components/qna/AttachmentField.tsx
 * @description Q&A 작성 폼용 첨부 파일 필드.
 * FileUploader로 R2 업로드 → publicUrl을 hidden input(name="attachmentUrl")으로 전송.
 * 업로드 완료 시 파일 칩 + 제거 버튼 노출.
 */
"use client";

import { Paperclip, X } from "lucide-react";
import { FileUploader } from "@/components/upload/FileUploader";

interface AttachmentFieldProps {
  /** 현재 첨부 URL (없으면 빈 문자열) */
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
}

export function AttachmentField({
  value,
  onChange,
  disabled,
  onUploadingChange,
}: AttachmentFieldProps) {
  return (
    <div className="space-y-2">
      {/* 서버 액션 전송용 hidden 필드 */}
      <input type="hidden" name="attachmentUrl" value={value} />

      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="flex-1 truncate text-foreground">{value.split("/").pop()}</span>
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={disabled}
            aria-label="첨부 제거"
            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <FileUploader
          prefix="qna/"
          label="파일 첨부"
          disabled={disabled}
          onUploadingChange={onUploadingChange}
          onUploadComplete={(publicUrl) => onChange(publicUrl)}
          onError={(message) => console.error("[AttachmentField]", message)}
        />
      )}
    </div>
  );
}
