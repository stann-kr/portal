/**
 * @file src/components/qna/AttachmentField.tsx
 * @description Q&A 작성 폼용 첨부 파일 필드.
 * FileUploader로 R2 업로드 → 인증형 delivery URL을 hidden input으로 전송.
 * 업로드 완료 시 파일 칩 + 제거 버튼 노출.
 */
"use client";

import { useState } from "react";
import { Paperclip, X } from "lucide-react";
import {
  FileUploader,
  type CompletedMediaUpload,
} from "@/components/upload/FileUploader";
import { abandonMediaUpload } from "@/lib/actions/upload";

interface AttachmentFieldProps {
  /** 현재 첨부 URL (없으면 빈 문자열) */
  value: string;
  mediaObjectId: string;
  draftOperationId: string;
  onChange: (upload: CompletedMediaUpload | null) => void;
  disabled?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
}

export function AttachmentField({
  value,
  mediaObjectId,
  draftOperationId,
  onChange,
  disabled,
  onUploadingChange,
}: AttachmentFieldProps) {
  const [uploadError, setUploadError] = useState("");

  return (
    <div className="space-y-2">
      {/* 서버 액션 전송용 hidden 필드 */}
      <input type="hidden" name="attachmentUrl" value={value} />
      <input type="hidden" name="attachmentObjectId" value={mediaObjectId} />

      {value ? (
        <div role="status" className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="flex-1 truncate text-foreground">{value.split("/").pop()}</span>
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
            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <FileUploader
          purpose="QNA_ATTACHMENT"
          draftOperationId={draftOperationId}
          label="파일 첨부"
          disabled={disabled}
          onUploadingChange={(isUploading) => {
            if (isUploading) setUploadError("");
            onUploadingChange?.(isUploading);
          }}
          onUploadComplete={(upload) => {
            setUploadError("");
            onChange(upload);
          }}
          onError={setUploadError}
        />
      )}
      {uploadError ? (
        <p role="alert" className="text-sm text-destructive">
          파일을 업로드하지 못했습니다. {uploadError}
        </p>
      ) : null}
    </div>
  );
}
