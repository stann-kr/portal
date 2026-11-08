/**
 * @file src/lib/audio/on-audio-prepared.ts
 * @description 변환 업로드가 끝난 오디오의 파형(peaks)을 넘겨받는 연결 지점.
 * 업로드 화면은 MP3 변환과 같은 흐름에서 만든 파형을 업로드 완료 직후 여기로 넘긴다.
 *
 * TODO(peaks 통합): 파형 저장 API가 준비되면 이 함수에서 `mediaObjectId`에 파형을 저장한다
 * (예: 저장 server action 호출). 지금은 아무것도 하지 않으며, 실패해도 업로드·게시를 막지 않아야 한다.
 */
import type { AudioPeaks } from "./peaks";

export function onAudioPrepared(peaks: AudioPeaks, mediaObjectId: string): void {
  void peaks;
  void mediaObjectId;
}
