/**
 * @file src/app/api/media/[mediaObjectId]/peaks/route.ts
 * @description 업로드 오디오의 파형(peaks) JSON. 오디오를 읽을 수 있는 로그인 사용자가 읽고,
 * 올린 사람(소유자)과 관리자만 쓴다.
 * - GET: 저장된 파형(200) 또는 404(없음·읽을 수 없음·오디오 아님).
 * - PUT/POST: 소유자·관리자만 `AudioPeaks`를 처음 한 번 저장한다(201). 이미 있으면 덮지 않고 200 `{ saved: false }`.
 *   읽을 수만 있는 다른 사람은 403이다(먼저 써서 소유자의 파형을 막지 못하게 한다).
 * 값은 R2 `<audio key>.peaks.json`에 두며 DB는 바꾸지 않는다.
 */
import { getActiveAuthSession } from "@/lib/auth-guard";
import { createDb } from "@/db/client";
import { AUDIO_PEAKS_MAX_BYTES, parseAudioPeaks } from "@/lib/audio/peaks";
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
type ResolvedAudio = { media: ReadableMediaObject; canWrite: boolean };

async function resolveAudio(context: RouteContext): Promise<ResolvedAudio | Response> {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) return json(401, { error: "로그인이 필요합니다." });
  const mediaObjectId = parseMediaUuidV4((await context.params).mediaObjectId);
  if (!mediaObjectId) return json(404, { error: "매체를 찾을 수 없습니다." });
  const media = await loadReadableMedia(createDb(), { id: session.user.id, role: session.user.role }, mediaObjectId);
  // 읽을 수 없는 매체는 존재 여부도 숨긴다.
  if (!media || !isAudioMedia(media)) return json(404, { error: "매체를 찾을 수 없습니다." });
  const canWrite = session.user.role === "admin" || (media.ownerId !== null && media.ownerId === session.user.id);
  return { media, canWrite };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const resolved = await resolveAudio(context);
  if (resolved instanceof Response) return resolved;
  const { media } = resolved;
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
  const resolved = await resolveAudio(context);
  if (resolved instanceof Response) return resolved;
  // 읽을 수 있어도 소유자·관리자가 아니면 쓰지 못한다(처음 쓴 값이 이기므로 남이 먼저 쓰면 소유자가 막힌다).
  if (!resolved.canWrite) return json(403, { error: "파형을 저장할 권한이 없습니다." });
  const { media } = resolved;
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
  // 처음 쓴 값이 이긴다. 같은 오디오의 파형이라 늦게 온 값은 버려도 된다.
  const saved = await (await getAudioPeaksStorage()).putIfAbsent(media.objectKey, JSON.stringify(parsed.value));
  return json(saved ? 201 : 200, { saved });
}

export const POST = PUT;
