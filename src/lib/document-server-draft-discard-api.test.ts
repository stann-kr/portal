import assert from "node:assert/strict";
import test from "node:test";
import type { DiscardDocumentServerDraftInput, DocumentServerDraftMutationResult } from "./document-server-draft-contract";
import {
  DOCUMENT_SERVER_DRAFT_DISCARD_ENDPOINT,
  createDocumentServerDraftDiscardHandler,
  postDocumentServerDraftDiscard,
} from "./document-server-draft-discard-api";

const INPUT: DiscardDocumentServerDraftInput = {
  sourceKey: "draft:document:qna-thread:student-1:new",
  operationId: "0c3f1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  expectedDraftVersion: 2,
  targetPayloadHashes: ["a".repeat(64)],
};
const OK: DocumentServerDraftMutationResult = { ok: true, replayed: false, operationResultVersion: 2, current: null };

function request(headers: Record<string, string>, body: string = JSON.stringify(INPUT)) {
  return new Request(`https://portal.test${DOCUMENT_SERVER_DRAFT_DISCARD_ENDPOINT}`, { method: "POST", headers, body });
}

test("폐기 경로는 같은 출처 JSON 요청만 server action에 넘긴다", async () => {
  const received: DiscardDocumentServerDraftInput[] = [];
  const handler = createDocumentServerDraftDiscardHandler({ discard: async (input) => { received.push(input); return OK; } });

  const ok = await handler(request({ "content-type": "application/json", "sec-fetch-site": "same-origin" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), OK);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(received, [INPUT]);

  const viaOrigin = await handler(request({ "content-type": "application/json", origin: "https://portal.test", host: "portal.test" }));
  assert.equal(viaOrigin.status, 200);

  for (const [headers, status] of [
    [{ "content-type": "application/json", "sec-fetch-site": "cross-site" }, 403],
    [{ "content-type": "application/json", origin: "https://evil.test", host: "portal.test" }, 403],
    [{ "content-type": "application/json" }, 403],
    [{ "content-type": "text/plain", "sec-fetch-site": "same-origin" }, 415],
  ] as const) {
    assert.equal((await handler(request(headers))).status, status);
  }
  assert.equal((await handler(request({ "content-type": "application/json", "sec-fetch-site": "same-origin" }, "{"))).status, 400);
  assert.equal((await handler(request({ "content-type": "application/json", "sec-fetch-site": "same-origin" }, "[]"))).status, 400);
  assert.equal(received.length, 2);
});

test("브라우저 요청은 같은 출처 POST JSON이고, 실패 응답과 끊김은 예외다", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const controller = new AbortController();
  const result = await postDocumentServerDraftDiscard(INPUT, {
    signal: controller.signal,
    fetcher: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json(OK);
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(result, OK);
  assert.equal(calls[0]?.url, DOCUMENT_SERVER_DRAFT_DISCARD_ENDPOINT);
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.init.credentials, "same-origin");
  assert.equal(calls[0]?.init.redirect, "error");
  assert.equal(calls[0]?.init.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), INPUT);

  await assert.rejects(postDocumentServerDraftDiscard(INPUT, {
    fetcher: (async () => new Response("", { status: 307 })) as unknown as typeof fetch,
  }));
  await assert.rejects(postDocumentServerDraftDiscard(INPUT, {
    fetcher: (async () => Response.json({ nope: true })) as unknown as typeof fetch,
  }));
});
