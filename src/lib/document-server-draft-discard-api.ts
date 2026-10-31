import type {
  DiscardDocumentServerDraftInput,
  DocumentServerDraftMutationResult,
} from "@/lib/document-server-draft-contract";

/**
 * 로그아웃 전 서버 초안 폐기용 JSON 경로. server action은 한 줄로 차례를 기다려 응답 없는 요청이 뒤의
 * 로그아웃까지 막으므로, 로그아웃 직전 폐기만 이 경로(fetch)로 보내고 시간 상한에서 끊는다.
 */
export const DOCUMENT_SERVER_DRAFT_DISCARD_ENDPOINT = "/api/document-drafts/discard";

type DiscardServerDraft = (
  input: DiscardDocumentServerDraftInput,
) => Promise<DocumentServerDraftMutationResult>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * 다른 사이트의 요청을 거부한다. 브라우저가 보내는 Sec-Fetch-Site를 먼저 보고, 없으면 Origin을
 * 요청 주소의 protocol과 Host로 만든 출처와 비교한다(http 출처가 https 경로로 보내는 요청도 거부).
 */
function isSameSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const source = new URL(origin);
    const protocol = new URL(request.url).protocol;
    return source.protocol === protocol && source.host === host;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 로그인하지 않은 요청은 401로 답한다(다른 API 경로와 같이). 입력 검증·계정 소유 확인·CAS는
 * server action(`discardDocumentServerDraft`)이 그대로 다시 맡는다.
 */
export function createDocumentServerDraftDiscardHandler({
  discard,
  isAuthenticated,
}: {
  discard: DiscardServerDraft;
  isAuthenticated: () => Promise<boolean>;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!isSameSiteRequest(request)) return json({ ok: false, reason: "INVALID_INPUT", current: null }, 403);
    if (!(await isAuthenticated())) return json({ ok: false, reason: "UNAUTHORIZED", current: null }, 401);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return json({ ok: false, reason: "INVALID_INPUT", current: null }, 415);
    }
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      return json({ ok: false, reason: "INVALID_INPUT", current: null }, 400);
    }
    if (!isRecord(value)) return json({ ok: false, reason: "INVALID_INPUT", current: null }, 400);
    const result = await discard({
      sourceKey: value.sourceKey as string,
      operationId: value.operationId as string,
      expectedDraftVersion: value.expectedDraftVersion as number,
      ...(value.targetPayloadHashes !== undefined
        ? { targetPayloadHashes: value.targetPayloadHashes as string[] }
        : {}),
      ...(value.supersededOperationIds !== undefined
        ? { supersededOperationIds: value.supersededOperationIds as string[] }
        : {}),
    });
    return json(result);
  };
}

function isMutationResult(value: unknown): value is DocumentServerDraftMutationResult {
  return isRecord(value) && typeof value.ok === "boolean" && (value.current === null || isRecord(value.current));
}

/** 브라우저에서 폐기 경로로 보낸다. 끊기면(signal) 예외로 끝나고, 호출한 쪽은 실패로 본다. */
export async function postDocumentServerDraftDiscard(
  input: DiscardDocumentServerDraftInput,
  { signal, fetcher = globalThis.fetch }: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<DocumentServerDraftMutationResult> {
  const response = await fetcher(DOCUMENT_SERVER_DRAFT_DISCARD_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error(`server draft discard failed: ${response.status}`);
  const value: unknown = await response.json();
  if (!isMutationResult(value)) throw new Error("server draft discard returned an invalid response");
  return value;
}
