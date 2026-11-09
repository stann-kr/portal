/**
 * @file src/lib/media-peaks-client.ts
 * @description 브라우저에서 업로드 오디오 파형(peaks)을 읽고 저장하는 helper.
 * 업로드 화면(새 오디오)과 재생 화면(예전 오디오의 첫 재생)이 함께 쓴다.
 */
import { parseAudioPeaks, type AudioPeaks } from "@/lib/audio/peaks";

function peaksUrl(mediaObjectId: string): string {
  return `/api/media/${encodeURIComponent(mediaObjectId)}/peaks`;
}

/** 저장된 파형. 아직 없거나 읽지 못하면 null(재생은 파형 없이도 된다). */
export async function loadAudioPeaks(mediaObjectId: string, signal?: AbortSignal): Promise<AudioPeaks | null> {
  try {
    const response = await fetch(peaksUrl(mediaObjectId), { credentials: "same-origin", cache: "no-store", signal });
    if (!response.ok) return null;
    const parsed = parseAudioPeaks(await response.json());
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/**
 * 파형을 저장한다. 처음 쓴 값만 남으므로 이미 있으면 그대로 둔다.
 * @returns 저장 요청이 받아들여졌으면(새로 저장 또는 이미 있음) true, 실패하면 false.
 */
export async function saveAudioPeaks(mediaObjectId: string, peaks: AudioPeaks): Promise<boolean> {
  const parsed = parseAudioPeaks(peaks);
  if (!parsed.ok) return false;
  try {
    const response = await fetch(peaksUrl(mediaObjectId), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.value),
    });
    return response.ok;
  } catch {
    return false;
  }
}
