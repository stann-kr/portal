/**
 * @file src/lib/audio/audio-convert-protocol.ts
 * @description 화면 스레드와 변환 Worker 사이 메시지 형식.
 */
import type { AudioPeaks } from "./peaks";
import type { Mp3BitrateKbps } from "./mp3-bitrate";

export type LosslessAudioKind = "pcm" | "flac";

export type AudioConvertRequest =
  | { type: "file"; kind: LosslessAudioKind; file: File; maxBytes: number }
  /** 머리글로 읽지 못한 짧은 파일을 화면 스레드가 decodeAudioData로 풀어 넘긴 경우. */
  | { type: "pcm"; sampleRate: number; channelData: Float32Array[]; maxBytes: number };

export type AudioConvertErrorCode = "unsupported" | "too-long" | "failed";

export type AudioConvertResponse =
  | { type: "progress"; percent: number }
  | { type: "done"; blob: Blob; bitrateKbps: Mp3BitrateKbps; durationSec: number; peaks: AudioPeaks }
  | { type: "error"; code: AudioConvertErrorCode; message: string };
