import assert from "node:assert/strict";
import test from "node:test";
import { createSerialQueue } from "./peaks-cache";
import { createSharedPeaksJobs } from "./shared-peaks-jobs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("같은 주소는 작업 하나를 나눠 쓰고, 구독자가 남아 있으면 멈추지 않는다", async () => {
  const signals: AbortSignal[] = [];
  const gate = deferred<string>();
  const jobs = createSharedPeaksJobs<string>({
    run: (_url, signal) => {
      signals.push(signal);
      return gate.promise;
    },
    keepAlive: () => false,
  });
  const a = jobs.subscribe("u");
  const b = jobs.subscribe("u");
  assert.equal(signals.length, 1, "한 번만 시작한다");
  a.release();
  a.release();
  assert.equal(signals[0].aborted, false, "b가 아직 기다린다(같은 구독을 두 번 놓아도 한 번만 센다)");
  gate.resolve("done");
  assert.equal(await b.promise, "done");
  b.release();
  assert.equal(signals[0].aborted, false, "끝난 뒤에 놓으면 멈출 것이 없다");
  assert.equal(jobs.isRunning("u"), false);
});

test("마지막 구독자가 떠나고 공용 플레이어가 그 주소를 재생하지 않으면 멈추고, 다음 구독은 새로 시작한다", async () => {
  const signals: AbortSignal[] = [];
  const jobs = createSharedPeaksJobs<string>({
    run: (_url, signal) => {
      signals.push(signal);
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve("aborted")));
    },
    keepAlive: () => false,
  });
  const first = jobs.subscribe("u");
  first.release();
  assert.equal(signals[0].aborted, true);
  assert.equal(jobs.isRunning("u"), false, "멈춘 작업은 바로 목록에서 빠진다");
  const second = jobs.subscribe("u");
  assert.equal(signals.length, 2, "새 작업을 시작한다");
  assert.equal(signals[1].aborted, false);
  second.release();
  assert.equal(await first.promise, "aborted");
});

test("공용 플레이어가 그 주소를 재생 중이면 화면이 모두 떠나도 끝까지 만든다", async () => {
  let playing = "u";
  const signals: AbortSignal[] = [];
  const gate = deferred<string>();
  const jobs = createSharedPeaksJobs<string>({
    run: (_url, signal) => {
      signals.push(signal);
      return gate.promise;
    },
    keepAlive: (url) => playing === url,
  });
  const job = jobs.subscribe("u");
  job.release();
  assert.equal(signals[0].aborted, false);
  playing = "other";
  gate.resolve("peaks");
  assert.equal(await job.promise, "peaks");
});

test("큐에서 차례를 기다리던 작업은 멈췄으면 시작하지 않는다", async () => {
  const enqueue = createSerialQueue();
  const started: string[] = [];
  const firstGate = deferred<void>();
  const jobs = createSharedPeaksJobs<string | null>({
    run: (url, signal) =>
      enqueue(async () => {
        if (signal.aborted) return null;
        started.push(url);
        if (url === "a") await firstGate.promise;
        return url;
      }),
    keepAlive: () => false,
  });
  const a = jobs.subscribe("a");
  const b = jobs.subscribe("b");
  b.release();
  firstGate.resolve();
  assert.equal(await a.promise, "a");
  assert.equal(await b.promise, null, "멈춘 작업은 결과가 없다");
  assert.deepEqual(started, ["a"], "b는 시작하지 않았다");
  a.release();
});
