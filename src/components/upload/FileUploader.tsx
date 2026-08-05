"use client";

import { useEffect, useRef, useState } from "react";
import { requestPresignedUploadUrl } from "@/lib/actions/upload";
import type { PresignedUrlOptions } from "@/lib/r2";

export interface FileUploaderProps {
  /** 업로드 완료 시 호출 — publicUrl과 R2 key를 전달 */
  onUploadComplete: (publicUrl: string, key: string) => void;
  /** 업로드 실패 시 호출 */
  onError?: (message: string) => void;
  /** 허용할 MIME 타입 (input accept 속성과 연동) */
  accept?: string;
  /** R2 저장 경로 prefix */
  prefix?: string;
  /** 추가 R2 옵션 */
  r2Options?: Omit<PresignedUrlOptions, "prefix">;
  /** 버튼/드롭존 레이블 */
  label?: string;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 업로드 진행 상태를 상위 폼에 전달 */
  onUploadingChange?: (isUploading: boolean) => void;
}

/**
 * Presigned URL 기반 R2 직접 업로드 컴포넌트
 * 파일 선택 → Server Action으로 Presigned URL 발급 → R2로 직접 PUT 전송
 */
export function FileUploader({
  onUploadComplete,
  onError,
  accept,
  prefix = "uploads/",
  r2Options,
  label = "파일 선택",
  disabled = false,
  onUploadingChange,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const mountedRef = useRef(true);
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      xhrRef.current?.abort();
      xhrRef.current = null;
      onUploadingChangeRef.current?.(false);
    };
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    onUploadingChangeRef.current?.(true);
    setProgress(0);

    try {
      // 1) Server Action으로 Presigned URL 요청
      const result = await requestPresignedUploadUrl({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        options: { prefix, ...r2Options },
      });

      if (!result.success || !result.uploadUrl || !result.key || !result.publicUrl) {
        throw new Error(result.error ?? "Presigned URL 발급 실패");
      }
      if (!mountedRef.current) return;

      // 2) R2에 직접 PUT 업로드 (XMLHttpRequest로 진행률 추적)
      await uploadWithProgress(file, result.uploadUrl, setProgress, (xhr) => {
        xhrRef.current = xhr;
      });
      xhrRef.current = null;
      if (!mountedRef.current) return;

      onUploadComplete(result.publicUrl, result.key);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "업로드 중 오류 발생";
      if (mountedRef.current) {
        console.error("[FileUploader]", message);
        onError?.(message);
      }
    } finally {
      xhrRef.current = null;
      if (mountedRef.current) {
        setIsUploading(false);
        onUploadingChangeRef.current?.(false);
        setProgress(0);
        // input 초기화 (같은 파일 재선택 가능하도록)
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        disabled={disabled || isUploading}
        className="hidden"
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading}
        aria-busy={isUploading}
        className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {isUploading ? "업로드 중..." : label}
      </button>

      {isUploading && (
        <div
          className="w-full"
          role="progressbar"
          aria-label={`${label} 업로드 진행률`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>업로드 중</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              aria-hidden="true"
              className="h-full rounded-full bg-primary transition-all duration-200 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** XMLHttpRequest 기반 업로드 (진행률 콜백 지원) */
function uploadWithProgress(
  file: File,
  presignedUrl: string,
  onProgress: (percent: number) => void,
  onRequest: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`R2 업로드 실패: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드 실패"));
    xhr.onabort = () => reject(new Error("업로드가 취소되었습니다."));

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}
