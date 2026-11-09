import assert from "node:assert/strict";
import test from "node:test";
import { createSerialQueue, LruMap } from "./peaks-cache";

test("LruMap은 용량을 넘으면 가장 오래 안 쓴 항목부터 버린다", () => {
  const lru = new LruMap<string, number | null>(2);
  lru.set("a", 1);
  lru.set("b", null);
  assert.equal(lru.get("a"), 1, "a를 최근으로 올린다");
  lru.set("c", 3);
  assert.equal(lru.has("b"), false, "가장 오래된 b가 빠진다");
  assert.equal(lru.has("a"), true);
  assert.equal(lru.has("c"), true);
  assert.equal(lru.size, 2);
});

test("직렬 큐는 디코딩을 한 번에 하나만 돌리고 실패해도 다음 작업을 이어간다", async () => {
  const enqueue = createSerialQueue();
  let running = 0;
  let maxRunning = 0;
  const order: string[] = [];
  const job = (name: string, fail = false) => async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(name);
    running -= 1;
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([enqueue(job("a")), enqueue(job("b", true)), enqueue(job("c"))]);
  assert.equal(maxRunning, 1);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.equal(results[1].status, "rejected");
  assert.deepEqual(results[2], { status: "fulfilled", value: "c" });
});
