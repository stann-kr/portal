"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  abandonMediaUpload,
  completeMediaUploadAction,
  requestMediaUpload,
} from "@/lib/actions/upload";
import {
  MEDIA_UPLOAD_CLIENT_TIMEOUT_MS,
  mediaUploadRequestHeaders,
  type MediaUploadPurpose,
} from "@/lib/media-lifecycle";

export type CompletedMediaUpload = {
  mediaObjectId: string;
  deliveryUrl: string;
};

export interface FileUploaderProps {
  /** R2 HEAD 검증까지 끝난 READY asset을 전달 */
  onUploadComplete: (upload: CompletedMediaUpload) => void;
  /** 업로드 실패 시 호출 */
  onError?: (message: string) => void;
  /** 허용할 MIME 타입 (input accept 속성과 연동) */
  accept?: string;
  /** 서버가 MIME/size/prefix/expiry 정책을 선택하는 업로드 목적 */
  purpose: MediaUploadPurpose;
  /** 이 파일을 참조하는 문서 초안의 안정적인 operation ID */
  draftOperationId: string;
  /** 버튼/드롭존 레이블 */
  label?: string;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 업로드 진행 상태를 상위 폼에 전달 */
  onUploadingChange?: (isUploading: boolean) => void;
}

type UploadRequest = { scope: string; xhr: XMLHttpRequest | null };
type UploadProgressState = { request: UploadRequest; scope: string; progress: number };

/**
 * Presigned URL 기반 R2 직접 업로드 컴포넌트
 * 파일 선택 → Server Action으로 Presigned URL 발급 → R2로 직접 PUT 전송
 */
export function FileUploader({
  onUploadComplete,
  onError,
  accept,
  purpose,
  draftOperationId,
  label = "파일 선택",
  disabled = false,
  onUploadingChange,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scope = JSON.stringify([purpose, draftOperationId]);
  const scopeRef = useRef(scope);
  const requestRef = useRef<UploadRequest | null>(null);
  const mountedRef = useRef(false);
  const onUploadingChangeRef = useRef(onUploadingChange);
  // 진행 표시는 시작한 요청과 그 문맥(목적·초안 작업)에 묶는다. 요청은 끝나거나 중단되면 자기 표시만 지우고,
  // 렌더 중인 문맥과 다른 요청의 진행은 보이지 않게 계산한다(이전 요청 중단은 아래 layout effect가 맡는다).
  const [upload, setUpload] = useState<UploadProgressState | null>(null);
  const isUploading = upload !== null && upload.scope === scope;
  const progress = isUploading ? upload.progress : 0;

  useLayoutEffect(() => {
    onUploadingChangeRef.current = onUploadingChange;
  });

  useLayoutEffect(() => {
    // 미완료 transition 렌더는 현재 업로드의 소유 문맥을 바꾸지 않는다.
    scopeRef.current = scope;
    mountedRef.current = true;
    if (inputRef.current) inputRef.current.value = "";
    return () => {
      mountedRef.current = false;
      const request = requestRef.current;
      requestRef.current = null;
      request?.xhr?.abort();
      onUploadingChangeRef.current?.(false);
    };
  }, [scope]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || disabled || !draftOperationId || requestRef.current) return;
    const request: UploadRequest = { scope, xhr: null };
    requestRef.current = request;
    const isCurrent = () => mountedRef.current && requestRef.current === request && scopeRef.current === request.scope;

    setUpload({ request, scope: request.scope, progress: 0 });
    onUploadingChangeRef.current?.(true);

    let issuedMediaObjectId: string | null = null;
    try {
      // 1) Server Action으로 Presigned URL 요청
      const result = await requestMediaUpload({
        purpose,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        draftOperationId,
      });

      if (!result.success) {
        throw new Error(result.error ?? "Presigned URL 발급 실패");
      }
      issuedMediaObjectId = result.mediaObjectId;
      if (!isCurrent()) {
        await abandonMediaUpload(result.mediaObjectId).catch(() => undefined);
        issuedMediaObjectId = null;
        return;
      }

      // 2) R2에 직접 PUT 업로드 (XMLHttpRequest로 진행률 추적)
      await uploadWithProgress(
        file,
        result.uploadUrl,
        result.uploadContentType,
        (value) => {
          if (isCurrent()) {
            setUpload((current) => (current?.request === request ? { ...current, progress: value } : current));
          }
        },
        (xhr) => {
          request.xhr = xhr;
        },
      );
      request.xhr = null;
      if (!isCurrent()) {
        await abandonMediaUpload(result.mediaObjectId).catch(() => undefined);
        issuedMediaObjectId = null;
        return;
      }
      const completed = await completeMediaUploadAction(result.mediaObjectId);
      if (!completed.success) {
        throw new Error(completed.error ?? "업로드 완료 확인 실패");
      }
      if (!isCurrent()) {
        await abandonMediaUpload(result.mediaObjectId).catch(() => undefined);
        issuedMediaObjectId = null;
        return;
      }

      onUploadComplete({
        mediaObjectId: completed.mediaObjectId,
        deliveryUrl: completed.deliveryUrl,
      });
      issuedMediaObjectId = null;
    } catch (err: unknown) {
      if (issuedMediaObjectId) {
        await abandonMediaUpload(issuedMediaObjectId).catch(() => undefined);
      }
      const message = err instanceof Error ? err.message : "업로드 중 오류 발생";
      if (isCurrent()) {
        console.error("[FileUploader]", message);
        onError?.(message);
      }
    } finally {
      request.xhr = null;
      // 중단된 이전 요청도 자기 진행 표시는 지운다. 다른 요청의 표시는 건드리지 않는다.
      setUpload((current) => (current?.request === request ? null : current));
      if (isCurrent()) {
        requestRef.current = null;
        onUploadingChangeRef.current?.(false);
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
        disabled={disabled || isUploading || !draftOperationId}
        className="hidden"
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading || !draftOperationId}
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
              className="h-full origin-left rounded-full bg-primary transition-transform duration-[var(--duration-standard)] ease-linear motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress / 100})` }}
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
  contentType: string,
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
    xhr.ontimeout = () => reject(new Error("업로드 제한 시간이 초과되었습니다."));

    xhr.open("PUT", presignedUrl);
    xhr.timeout = MEDIA_UPLOAD_CLIENT_TIMEOUT_MS;
    for (const [name, value] of Object.entries(
      mediaUploadRequestHeaders(contentType),
    )) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send(file);
  });
}
