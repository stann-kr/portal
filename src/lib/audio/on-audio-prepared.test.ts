import assert from "node:assert/strict";
import test from "node:test";
import { onAudioPrepared } from "./on-audio-prepared";
import { AUDIO_PEAKS_COUNT, type AudioPeaks } from "./peaks";

const PEAKS: AudioPeaks = { version: 1, duration: 61.5, peaks: Array.from({ length: AUDIO_PEAKS_COUNT }, (_, index) => (index % 10) / 10) };

test("onAudioPrepared는 업로드한 매체 id로 파형 API에 PUT 저장한다", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try {
    assert.equal(await onAudioPrepared(PEAKS, "media 1"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/media/media%201/peaks");
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), PEAKS);
});

test("onAudioPrepared는 바로 돌아오고 저장 실패·예외를 게시 흐름으로 올리지 않는다", async () => {
  let resolveSave: (value: boolean) => void = () => {};
  const slow = onAudioPrepared(PEAKS, "m1", () => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
  let settled = false;
  void slow.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, "저장을 기다리지 않고 돌아온다");
  resolveSave(true);
  assert.equal(await slow, true);

  assert.equal(await onAudioPrepared(PEAKS, "m1", async () => false), false);
  assert.equal(await onAudioPrepared(PEAKS, "m1", () => Promise.reject(new Error("network"))), false);
  assert.equal(await onAudioPrepared(PEAKS, "m1", () => { throw new Error("sync"); }), false);
  let called = false;
  assert.equal(await onAudioPrepared(PEAKS, "", async () => { called = true; return true; }), false);
  assert.equal(called, false);
});

test("onAudioPrepared는 네트워크 오류여도 reject하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  try {
    assert.equal(await onAudioPrepared(PEAKS, "m1"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
