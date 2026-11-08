/**
 * @file src/components/upload/AudioUploadStatus.tsx
 * @description 오디오 업로드 상태 카드(캔버스 MixsetAudio "업로드 변환"): MP3로 바꾸는 중 · 올리는 중 · 바꾸지 못함.
 */
"use client";

import { AlertTriangle } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { formatRemaining } from "@/lib/audio/prepare-upload";

const SMALL_BUTTON = buttonClassName({
  variant: "outline",
  className: "h-11 self-start rounded-touch px-3 text-ui md:h-7 md:rounded-md md:px-2.5 md:text-xs",
});

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

type ProgressCardProps = {
  fileName: string;
  fileSize: number;
  percent: number;
  label: string;
  hint?: string;
  onCancel?: () => void;
  cancelLabel?: string;
};

function ProgressCard({ fileName, fileSize, percent, label, hint, onCancel, cancelLabel }: ProgressCardProps) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div role="status" className="flex flex-col gap-2.5 rounded-lg border border-border px-4 py-3.5">
      <span className="break-all text-body font-medium text-foreground">
        {fileName} · {formatFileSize(fileSize)}
      </span>
      <span
        role="progressbar"
        aria-label={label.replace(/\s*\d+%.*$/u, "")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="block h-1 overflow-hidden rounded-full bg-muted"
      >
        <span
          aria-hidden="true"
          className="block h-1 origin-left bg-foreground transition-transform duration-[var(--duration-standard)] ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${value / 100})` }}
        />
      </span>
      <span className="text-xs text-secondary-foreground">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {onCancel ? (
        <button type="button" onClick={onCancel} className={SMALL_BUTTON}>
          {cancelLabel ?? "취소"}
        </button>
      ) : null}
    </div>
  );
}

export function AudioConvertingCard({
  fileName,
  fileSize,
  percent,
  etaSec,
  onCancel,
}: {
  fileName: string;
  fileSize: number;
  percent: number;
  etaSec: number | null;
  onCancel: () => void;
}) {
  const rounded = Math.round(percent);
  return (
    <ProgressCard
      fileName={fileName}
      fileSize={fileSize}
      percent={rounded}
      label={`MP3로 바꾸는 중 ${rounded}%${etaSec !== null ? ` · ${formatRemaining(etaSec)}` : ""}`}
      hint="이 탭을 열어 두세요. 원본은 올라가지 않습니다."
      onCancel={onCancel}
      cancelLabel="변환 취소"
    />
  );
}

export function AudioUploadingCard({
  fileName,
  fileSize,
  percent,
  onCancel,
}: {
  fileName: string;
  fileSize: number;
  percent: number;
  onCancel: () => void;
}) {
  return (
    <ProgressCard
      fileName={fileName}
      fileSize={fileSize}
      percent={percent}
      label={`올리는 중 ${Math.round(percent)}%`}
      onCancel={onCancel}
      cancelLabel="업로드 취소"
    />
  );
}

export function AudioConvertFailedCard({ message, onPickAnother, disabled }: { message: string; onPickAnother: () => void; disabled?: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-lg border border-border px-4 py-3.5">
      <span className="inline-flex items-center gap-1.5 text-body font-medium text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        바꾸지 못했습니다
      </span>
      <span className="text-xs leading-[18px] text-secondary-foreground">{message}</span>
      <button type="button" onClick={onPickAnother} disabled={disabled} className={SMALL_BUTTON}>
        다른 파일 고르기
      </button>
    </div>
  );
}
