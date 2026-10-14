import assert from "node:assert/strict";
import test from "node:test";
import { decodeCommunityPostCursor, encodeCommunityPostCursor } from "./community-post-page";

test("커뮤니티 목록 cursor는 정렬 키를 그대로 왕복한다", () => {
  const cursor = { pinned: 1 as const, createdAt: 1_791_600_000, id: "8f9c2a4e-1d3b-4c5e-9f7a-6b8c0d2e4f61" };
  const encoded = encodeCommunityPostCursor(cursor);
  assert.match(encoded, /^[\w-]+$/u, "URL·form에 그대로 실을 수 있다");
  assert.deepEqual(decodeCommunityPostCursor(encoded), cursor);
});

test("형식이 다른 cursor는 다음 페이지 조건으로 쓰지 않는다", () => {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/u, "");
  for (const value of [
    undefined,
    "",
    "not base64!",
    "a".repeat(600),
    encode({ pinned: 0, createdAt: 1, id: "x" }),
    encode([2, 1, "x"]),
    encode([0, -1, "x"]),
    encode([0, 1.5, "x"]),
    encode([0, 1, ""]),
    encode([0, 1, "x".repeat(200)]),
    encode([0, 1, "x", "extra"]),
  ]) {
    assert.equal(decodeCommunityPostCursor(value), null, String(value).slice(0, 40));
  }
});
