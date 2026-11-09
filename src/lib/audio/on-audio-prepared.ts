/**
 * @file src/lib/audio/on-audio-prepared.ts
 * @description 변환 업로드가 끝난 오디오의 파형(peaks)을 넘겨받는 연결 지점.
 * 업로드 화면은 MP3 변환과 같은 흐름에서 만든 파형을 업로드 완료 직후 여기로 넘기고,
 * 여기서 파형 API(PUT /api/media/{id}/peaks)로 저장한다. 저장은 기다리지 않으며(fire-and-forget)
 * 실패해도 업로드·게시를 막지 않는다. 파형이 없으면 재생 화면이 첫 재생 때 다시 만들어 저장한다.
 */
import { saveAudioPeaks } from "@/lib/media-peaks-client";
import type { AudioPeaks } from "./peaks";

type SavePeaks = (mediaObjectId: string, peaks: AudioPeaks) => Promise<boolean>;

/**
 * 파형 저장을 시작하고 바로 돌아온다. 돌려주는 Promise는 테스트·호출부가 끝을 기다릴 때만 쓰며 절대 reject하지 않는다.
 * 실패는 기록하지 않는다(매체 id·파형 값은 로그에 남기지 않는다).
 */
export function onAudioPrepared(
  peaks: AudioPeaks,
  mediaObjectId: string,
  save: SavePeaks = saveAudioPeaks,
): Promise<boolean> {
  if (!mediaObjectId) return Promise.resolve(false);
  let pending: Promise<boolean>;
  try {
    pending = save(mediaObjectId, peaks);
  } catch {
    return Promise.resolve(false);
  }
  return Promise.resolve(pending).then((saved) => saved === true, () => false);
}
