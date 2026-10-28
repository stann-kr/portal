/** 테스트 전용: 순서대로 응답하고 모든 호출을 기록하는 fetch 대역. 네트워크를 쓰지 않는다. */
export type RecordedCall = { url: string; method: string; headers: Record<string, string>; body: string };

export type FakeHandler = (call: RecordedCall) => Response | Promise<Response>;

export function createFakeFetch(handlers: FakeHandler[]): { fetchImpl: typeof fetch; calls: RecordedCall[]; remaining: () => number } {
  const queue = [...handlers];
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    if (init?.redirect !== "manual") throw new Error("redirect must be manual");
    const handler = queue.shift();
    if (!handler) throw new Error(`Unexpected request ${call.method} ${call.url}`);
    return handler(call);
  }) as typeof fetch;
  return { fetchImpl, calls, remaining: () => queue.length };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function xmlResponse(body: string, status = 207, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "application/xml; charset=utf-8", ...headers } });
}
