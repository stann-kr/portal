/**
 * @file src/app/api/media/[mediaObjectId]/peaks/route.ts
 * @description 업로드 오디오의 파형(peaks) JSON. 오디오를 읽을 수 있는 로그인 사용자가 읽고 쓴다.
 * 파형은 처음 만든 브라우저가 한 번 저장하고, 그 뒤로는 모두 여기서 불러온다(재생할 때마다 다시 만들지 않는다).
 * - GET: 저장된 파형(200) 또는 404(없음·읽을 수 없음·오디오 아님).
 * - PUT/POST: 오디오를 읽을 수 있는 사람(소유자·관리자·게시물을 볼 수 있는 학생)이 아직 없는 `AudioPeaks`를
 *   처음 한 번 저장한다(201). 이미 있으면 덮지 않고 200 `{ saved: false }`.
 *   모양·크기 검증(`parseAudioPeaks`)에 더해, 길이가 파일 크기와 맞지 않는 값(평균 비트레이트가 4kbps 미만 또는
 *   10,000kbps 초과)은 400으로 거절한다. 읽을 수 없는 매체는 존재도 숨긴 404, 로그인 전은 401이다.
 * 값은 R2 `<audio key>.peaks.json`에 두며 DB는 바꾸지 않는다.
 */
import { getActiveAuthSession } from "@/lib/auth-guard";
import { createDb } from "@/db/client";
import { AUDIO_PEAKS_COUNT, AUDIO_PEAKS_MAX_BYTES, isPlausiblePeaksDuration, parseAudioPeaks } from "@/lib/audio/peaks";
import { parseMediaUuidV4 } from "@/lib/media-lifecycle";
import { isAudioMedia, loadReadableMedia, type ReadableMediaObject } from "@/lib/media-read-access";
import { getAudioPeaksStorage } from "@/lib/r2";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

type RouteContext = { params: Promise<{ mediaObjectId: string }> };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Content-Type": "application/json" } });
}

/** 세션·매체 ID·읽기 권한·오디오 여부를 확인한다. 실패하면 응답을 돌려준다. */
async function resolveAudio(context: RouteContext): Promise<ReadableMediaObject | Response> {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) return json(401, { error: "로그인이 필요합니다." });
  const mediaObjectId = parseMediaUuidV4((await context.params).mediaObjectId);
  if (!mediaObjectId) return json(404, { error: "매체를 찾을 수 없습니다." });
  const media = await loadReadableMedia(createDb(), { id: session.user.id, role: session.user.role }, mediaObjectId);
  // 읽을 수 없는 매체는 존재 여부도 숨긴다.
  if (!media || !isAudioMedia(media)) return json(404, { error: "매체를 찾을 수 없습니다." });
  return media;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const media = await resolveAudio(context);
  if (media instanceof Response) return media;
  const stored = await (await getAudioPeaksStorage()).get(media.objectKey);
  if (!stored) return json(404, { error: "아직 파형이 없습니다." });
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return json(404, { error: "아직 파형이 없습니다." });
  }
  const parsed = parseAudioPeaks(raw);
  return parsed.ok ? json(200, parsed.value) : json(404, { error: "아직 파형이 없습니다." });
}

/** 상한을 넘으면 끝까지 읽지 않고 멈춘다. */
async function readBoundedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > AUDIO_PEAKS_MAX_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > AUDIO_PEAKS_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const media = await resolveAudio(context);
  if (media instanceof Response) return media;
  const text = await readBoundedText(request);
  if (text === null) return json(413, { error: "파형 데이터가 너무 큽니다." });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json(400, { error: "파형 데이터가 올바르지 않습니다." });
  }
  const parsed = parseAudioPeaks(raw);
  if (!parsed.ok) return json(400, { error: parsed.error });
  if (parsed.value.peaks.length !== AUDIO_PEAKS_COUNT || !isPlausiblePeaksDuration(parsed.value.duration, media.actualSizeBytes)) {
    return json(400, { error: "파형 길이가 오디오와 맞지 않습니다." });
  }
  // 처음 쓴 값이 이긴다. 같은 오디오의 파형이라 늦게 온 값은 버려도 된다.
  const saved = await (await getAudioPeaksStorage()).putIfAbsent(media.objectKey, JSON.stringify(parsed.value));
  return json(saved ? 201 : 200, { saved });
}

export const POST = PUT;
