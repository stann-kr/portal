"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { PrepareAudioError, losslessAudioKind, prepareAudioUpload, type PreparedAudioUpload } from "@/lib/audio/prepare-upload";
import { AudioConvertFailedCard, AudioConvertingCard, AudioUploadingCard } from "@/components/upload/AudioUploadStatus";

export type CompletedMediaUpload = {
  mediaObjectId: string;
  deliveryUrl: string;
  /** convertAudio일 때만: 올린 파일의 준비 결과(변환 여부·비트레이트·길이·파형). */
  audio?: PreparedAudioUpload;
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
  /**
   * 선택 버튼 모양.
   * block(기본): 줄을 채우는 외곽선 버튼과 아래 진행 막대.
   * inline: 클립 아이콘이 있는 외곽선 버튼(QnaNew 32px · MobileQnaNew 44px).
   * composer: 답글 상자 바닥 줄의 클립 버튼(QnaThread 32px 글자 버튼 · MobileQnaThread 44×44 아이콘 버튼). 진행은 버튼 아래 얇은 막대로 보인다.
   */
  trigger?: "block" | "inline" | "composer";
  /**
   * 오디오 전용: WAV·AIFF·FLAC은 브라우저에서 MP3로 바꾼 뒤 올리고(원본은 올리지 않음) 진행을 상태 카드로 보인다.
   * 변환하지 못하면 onError 대신 "바꾸지 못했습니다" 카드를 보인다.
   * block은 모든 진행을 상태 카드로 보이고, inline·composer는 평소 버튼을 두되 변환하는 오디오의
   * 변환·업로드·실패만 같은 카드로 보인다(그 밖의 파일은 평소 진행 표시 그대로).
   */
  convertAudio?: boolean;
}

type UploadRequest = { scope: string; xhr: XMLHttpRequest | null; abort: AbortController };
type UploadProgressState = { request: UploadRequest; scope: string; progress: number; fileName: string; fileSize: number; converted: boolean };
type ConversionState = { request: UploadRequest; scope: string; fileName: string; fileSize: number; percent: number; etaSec: number | null };
type FailureState = { scope: string; message: string };

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
  trigger = "block",
  convertAudio = false,
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
  const [conversion, setConversion] = useState<ConversionState | null>(null);
  const isConverting = conversion !== null && conversion.scope === scope;
  const [failure, setFailure] = useState<FailureState | null>(null);
  const visibleFailure = failure !== null && failure.scope === scope ? failure.message : null;

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
      request?.abort.abort();
      if (request) setConversion((current) => (current?.request === request ? null : current));
      // 중단한 요청의 진행 표시도 바로 지워 같은 문맥으로 돌아왔을 때 버튼이 잠겨 보이지 않게 한다.
      if (request) setUpload((current) => (current?.request === request ? null : current));
      onUploadingChangeRef.current?.(false);
    };
  }, [scope]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || disabled || !draftOperationId || requestRef.current) return;
    const request: UploadRequest = { scope, xhr: null, abort: new AbortController() };
    requestRef.current = request;
    const isOwner = () => mountedRef.current && requestRef.current === request && scopeRef.current === request.scope;
    // 사용자가 취소한 요청은 계속 진행하지 않는다(정리는 아래 finally가 isOwner로 한다).
    const isCurrent = () => isOwner() && !request.abort.signal.aborted;

    onUploadingChangeRef.current?.(true);
    setFailure(null);

    let issuedMediaObjectId: string | null = null;
    let uploadFile: File = file;
    let prepared: PreparedAudioUpload | undefined;
    try {
      // 0) 오디오 변환(WAV·AIFF·FLAC → MP3). 그 밖의 형식은 그대로 둔다.
      if (convertAudio) {
        // MP3로 바꿀 파일(WAV·AIFF·FLAC)만 변환 카드를 보인다. 그 밖의 파일은 크기만 확인하고 그대로 올린다.
        if (losslessAudioKind(file)) setConversion({ request, scope: request.scope, fileName: file.name, fileSize: file.size, percent: 0, etaSec: null });
        try {
          prepared = await prepareAudioUpload(file, {
            signal: request.abort.signal,
            onProgress: ({ percent, etaSec }) => {
              if (isCurrent()) {
                setConversion((current) => (current?.request === request ? { ...current, percent, etaSec } : current));
              }
            },
          });
        } finally {
          setConversion((current) => (current?.request === request ? null : current));
        }
        uploadFile = prepared.file;
        if (!isCurrent()) return;
      }
      setUpload({ request, scope: request.scope, progress: 0, fileName: uploadFile.name, fileSize: uploadFile.size, converted: prepared?.converted ?? false });

      // 1) Server Action으로 Presigned URL 요청
      const result = await requestMediaUpload({
        purpose,
        fileName: uploadFile.name,
        mimeType: uploadFile.type,
        fileSize: uploadFile.size,
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
        uploadFile,
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
        ...(prepared ? { audio: prepared } : {}),
      });
      issuedMediaObjectId = null;
    } catch (err: unknown) {
      if (issuedMediaObjectId) {
        await abandonMediaUpload(issuedMediaObjectId).catch(() => undefined);
      }
      const message = err instanceof Error ? err.message : "업로드 중 오류 발생";
      // 사용자가 취소했으면 오류를 알리지 않는다.
      if (request.abort.signal.aborted) {
        // 취소: 아래 finally가 상태를 정리한다.
      } else if (err instanceof PrepareAudioError && err.code !== "too-large") {
        if (isCurrent()) setFailure({ scope: request.scope, message: err.message });
      } else if (isOwner()) {
        console.error("[FileUploader]", message);
        onError?.(message);
      }
    } finally {
      request.xhr = null;
      // 중단된 이전 요청도 자기 진행 표시는 지운다. 다른 요청의 표시는 건드리지 않는다.
      setUpload((current) => (current?.request === request ? null : current));
      if (isOwner()) {
        requestRef.current = null;
        onUploadingChangeRef.current?.(false);
        // input 초기화 (같은 파일 재선택 가능하도록)
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }

  const isTriggerDisabled = disabled || isUploading || isConverting || !draftOperationId;
  const cancelCurrent = () => {
    const request = requestRef.current;
    if (!request) return;
    request.abort.abort();
    request.xhr?.abort();
  };
  const buttonText = isUploading ? "업로드 중..." : label;
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      onChange={handleFileChange}
      disabled={isTriggerDisabled}
      className="hidden"
      aria-label={label}
    />
  );

  // inline·composer에서 변환한 오디오의 진행·실패는 block과 같은 상태 카드로 버튼 자리에 보인다.
  const audioStatusCard = !convertAudio || trigger === "block"
    ? null
    : isConverting && conversion ? (
      <AudioConvertingCard
        fileName={conversion.fileName}
        fileSize={conversion.fileSize}
        percent={conversion.percent}
        etaSec={conversion.etaSec}
        onCancel={cancelCurrent}
      />
    ) : isUploading && upload?.converted ? (
      <AudioUploadingCard fileName={upload.fileName} fileSize={upload.fileSize} percent={progress} onCancel={cancelCurrent} />
    ) : visibleFailure ? (
      <AudioConvertFailedCard message={visibleFailure} disabled={isTriggerDisabled} onPickAnother={() => inputRef.current?.click()} />
    ) : null;
  if (audioStatusCard) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-2", trigger === "composer" && "w-full md:w-80")}>
        {fileInput}
        {audioStatusCard}
      </div>
    );
  }

  if (trigger === "composer") {
    return (
      <div className="relative inline-flex shrink-0">
        {fileInput}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isTriggerDisabled}
          aria-busy={isUploading}
          title={label}
          className={buttonClassName({
            variant: "ghost",
            className: "size-11 gap-1.5 rounded-touch p-0 md:h-8 md:w-auto md:rounded-md md:px-2 md:text-ui",
          })}
        >
          <Paperclip className="size-[18px] shrink-0 md:size-3.5" strokeWidth={1.6} aria-hidden="true" />
          <span className="max-md:sr-only">{buttonText}</span>
        </button>
        {isUploading ? (
          <div
            role="progressbar"
            aria-label={`${label} 업로드 진행률`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="pointer-events-none absolute inset-x-1.5 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              aria-hidden="true"
              className="h-full origin-left bg-foreground transition-transform duration-[var(--duration-standard)] ease-linear motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (convertAudio && trigger === "block") {
    return (
      <div className="flex flex-col gap-2">
        {fileInput}
        {isConverting && conversion ? (
          <AudioConvertingCard
            fileName={conversion.fileName}
            fileSize={conversion.fileSize}
            percent={conversion.percent}
            etaSec={conversion.etaSec}
            onCancel={cancelCurrent}
          />
        ) : isUploading && upload ? (
          <AudioUploadingCard fileName={upload.fileName} fileSize={upload.fileSize} percent={progress} onCancel={cancelCurrent} />
        ) : visibleFailure ? (
          <AudioConvertFailedCard
            message={visibleFailure}
            disabled={isTriggerDisabled}
            onPickAnother={() => inputRef.current?.click()}
          />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isTriggerDisabled}
            className={buttonClassName({
              variant: "outline",
              className: "h-11 rounded-touch px-4 text-body md:h-8 md:rounded-md md:px-3.5 md:text-ui",
            })}
          >
            {label}
          </button>
        )}
      </div>
    );
  }

  const isInline = trigger === "inline";
  return (
    <div className={cn("flex flex-col gap-2", isInline && "items-start")}>
      {fileInput}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isTriggerDisabled}
        aria-busy={isUploading}
        className={buttonClassName({
          variant: "outline",
          className: isInline
            ? "h-11 rounded-touch px-3.5 text-body md:h-8 md:rounded-md md:px-3 md:text-ui"
            : "h-11 rounded-touch px-4 text-body md:h-8 md:rounded-md md:px-3.5 md:text-ui",
        })}
      >
        {isInline ? (
          <Paperclip className="size-4 shrink-0 md:size-3.5" strokeWidth={1.6} aria-hidden="true" />
        ) : null}
        {buttonText}
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
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>업로드 중</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              aria-hidden="true"
              className="h-full origin-left bg-foreground transition-transform duration-[var(--duration-standard)] ease-linear motion-reduce:transition-none"
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
