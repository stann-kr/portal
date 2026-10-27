/**
 * Google Calendar 변경 알림(web_hook) route 본문. route 파일은 의존성만 연결한다.
 *
 * Google은 로그인 없이 POST한다. 검증은 channel id + token(sha256 상수 시간 비교) + resource id로 하며,
 * 맞지 않으면 정보 없이 404(빈 본문)를 준다. `sync`(등록 확인) 알림은 200만 준다.
 * 그 외에는 바로 200을 주고 동기화는 응답 뒤에 예약한다. header·본문은 log에 남기지 않는다.
 */

export type GoogleNotifyRouteDeps = {
  /** 맞는 channel이면 매핑 id, 아니면 null. */
  resolve: (input: { channelId: string | null; token: string | null; resourceId: string | null }) => Promise<string | null>;
  /** 응답 뒤 동기화를 예약한다. 실패해도 응답은 바뀌지 않는다. */
  scheduleSync: (mappingId: string) => void | Promise<void>;
};

function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

export function createGoogleNotifyHandler(deps: GoogleNotifyRouteDeps): (request: Request) => Promise<Response> {
  return async function handleGoogleNotify(request: Request): Promise<Response> {
    const channelId = request.headers.get("x-goog-channel-id");
    const token = request.headers.get("x-goog-channel-token");
    const resourceId = request.headers.get("x-goog-resource-id");
    const state = request.headers.get("x-goog-resource-state");
    if (!channelId || !token) return emptyResponse(404);
    let mappingId: string | null;
    try {
      mappingId = await deps.resolve({ channelId, token, resourceId });
    } catch {
      // DB 장애: Google이 다시 보내도록 5xx(본문 없음).
      return emptyResponse(503);
    }
    if (!mappingId) return emptyResponse(404);
    if (state === "sync") return emptyResponse(200);
    try {
      await deps.scheduleSync(mappingId);
    } catch {
      // 예약 실패는 다음 조회·예약 동기화가 이어 간다.
    }
    return emptyResponse(200);
  };
}
