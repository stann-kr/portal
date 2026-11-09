/**
 * @file src/lib/audio/audio-convert.worker.ts
 * @description 무손실 오디오(WAV·AIFF·FLAC)를 MP3로 바꾸는 module Worker. 화면 스레드를 막지 않도록
 * 읽기·디코드·인코딩·파형 계산을 모두 여기서 한다. 취소는 화면 쪽이 Worker를 종료해 처리한다.
 */
import { createEncoder } from "wasm-media-encoders";
import { UnsupportedAudioFormatError } from "./pcm-header";
import {
  AudioTooLongError,
  createFlacFileSource,
  createMemorySource,
  createPcmFileSource,
  encodeSourceToMp3,
  type Mp3EncoderLike,
  type PcmSource,
} from "./mp3-encode";
import type { AudioConvertRequest, AudioConvertResponse } from "./audio-convert-protocol";

/**
 * LAME(LGPL-2.0) WebAssembly는 JS 묶음에 넣지 않고 public/vendor/lame/mp3.wasm을 따로 받는다.
 * 같은 인터페이스의 다른 빌드로 이 파일만 바꿔 쓸 수 있게 하기 위함이다(docs/THIRD_PARTY_NOTICES.md).
 * 파일은 node_modules/wasm-media-encoders/wasm/mp3.wasm 사본이며 audio-vendor-wasm.test.ts가 일치를 확인한다.
 */
const LAME_WASM_URL = "/vendor/lame/mp3.wasm";

const post = (message: AudioConvertResponse) => (self as unknown as Worker).postMessage(message);

async function openSource(request: AudioConvertRequest): Promise<PcmSource> {
  if (request.type === "pcm") return createMemorySource(request.sampleRate, request.channelData);
  if (request.kind === "flac") {
    return createFlacFileSource(request.file, async () => {
      const { FLACDecoder } = await import("@wasm-audio-decoders/flac");
      return new FLACDecoder();
    });
  }
  return createPcmFileSource(request.file);
}

self.onmessage = async (event: MessageEvent<AudioConvertRequest>) => {
  try {
    const source = await openSource(event.data);
    const result = await encodeSourceToMp3(source, {
      createEncoder: () => createEncoder("audio/mpeg", LAME_WASM_URL) as Promise<Mp3EncoderLike>,
      maxBytes: event.data.maxBytes,
      onProgress: (percent) => post({ type: "progress", percent }),
    });
    post({ type: "done", ...result });
  } catch (error) {
    const code = error instanceof UnsupportedAudioFormatError
      ? "unsupported"
      : error instanceof AudioTooLongError
        ? "too-long"
        : "failed";
    post({ type: "error", code, message: error instanceof Error ? error.message : String(error) });
  }
};
