import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccountCleanupRegisterHandler,
  createAccountCleanupStatusHandler,
} from "./account-cleanup-handlers";

const DIGEST = "a".repeat(64);
const NOW = new Date("2026-01-01T00:00:00.000Z");

function request(tokenDigest = DIGEST): Request {
  return new Request("https://portal.example/api/account-cleanup/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ tokenDigest }),
  });
}

test("register handler는 인증 session owner만 bind하고 admin·미인증을 거부한다", async () => {
  let registeredInput: {
    ownerId: string;
    tokenDigest: string;
    now: Date;
  } | null = null;
  const handler = createAccountCleanupRegisterHandler({
    requireSession: async () => ({ user: { id: "student-session" } }),
    registerToken: async (input) => {
      registeredInput = input;
      return { ok: true, status: "REGISTERED" };
    },
    now: () => NOW,
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(registeredInput, {
    ownerId: "student-session",
    tokenDigest: DIGEST,
    now: NOW,
  });

  const unauthenticated = createAccountCleanupRegisterHandler({
    requireSession: async () => {
      throw new Error("unauthenticated");
    },
    registerToken: async () => {
      assert.fail("미인증 요청이 token 등록에 도달했습니다.");
    },
    now: () => NOW,
  });
  assert.equal((await unauthenticated(request())).status, 401);

  const admin = createAccountCleanupRegisterHandler({
    requireSession: async () => ({ user: { id: "admin-session" } }),
    registerToken: async () => ({
      ok: false,
      reason: "STUDENT_NOT_FOUND",
    }),
    now: () => NOW,
  });
  assert.equal((await admin(request())).status, 403);
});

test("register handler는 payload와 DB 실패를 400/503으로 좁힌다", async () => {
  let authCalls = 0;
  const handler = createAccountCleanupRegisterHandler({
    requireSession: async () => {
      authCalls += 1;
      return { user: { id: "student-session" } };
    },
    registerToken: async () => {
      throw new Error("D1 unavailable");
    },
    now: () => NOW,
  });
  assert.equal((await handler(request("invalid"))).status, 400);
  assert.equal(authCalls, 0);
  assert.equal((await handler(request())).status, 503);
});

test("status handler는 unknown과 ACTIVE를 같은 NO_ACTION 응답으로 숨긴다", async () => {
  const unknownHandler = createAccountCleanupStatusHandler({
    findDeletion: async () => null,
  });
  const activeHandler = createAccountCleanupStatusHandler({
    findDeletion: async () => ({
      tokenStatus: "ACTIVE",
      deletionStatus: null,
      requestedAt: null,
      erasedAt: null,
      aliasedAt: null,
    }),
  });
  const unknown = await unknownHandler(request());
  const active = await activeHandler(request());
  assert.equal(unknown.status, 200);
  assert.equal(active.status, 200);
  assert.deepEqual(await unknown.json(), { ok: true, status: "NO_ACTION" });
  assert.deepEqual(await active.json(), { ok: true, status: "NO_ACTION" });
  assert.equal(
    unknown.headers.get("cache-control"),
    active.headers.get("cache-control"),
  );
});

test("status handler는 완료된 token/job receipt만 DELETED로 반환하고 DB 실패는 503이다", async () => {
  const deletedHandler = createAccountCleanupStatusHandler({
    findDeletion: async () => ({
      tokenStatus: "BOUND",
      deletionStatus: "ERASED",
      requestedAt: NOW,
      erasedAt: NOW,
      aliasedAt: null,
    }),
  });
  const erasingHandler = createAccountCleanupStatusHandler({
    findDeletion: async () => ({
      tokenStatus: "BOUND",
      deletionStatus: "ERASING",
      requestedAt: NOW,
      erasedAt: null,
      aliasedAt: null,
    }),
  });
  const ephemeralReceiptHandler = createAccountCleanupStatusHandler({
    findDeletion: async () => ({
      tokenStatus: null,
      deletionStatus: "ERASED",
      requestedAt: NOW,
      erasedAt: NOW,
      aliasedAt: null,
    }),
  });
  const failingHandler = createAccountCleanupStatusHandler({
    findDeletion: async () => {
      throw new Error("D1 unavailable");
    },
  });

  assert.deepEqual(await (await deletedHandler(request())).json(), {
    ok: true,
    status: "DELETED",
  });
  assert.deepEqual(await (await erasingHandler(request())).json(), {
    ok: true,
    status: "NO_ACTION",
  });
  assert.deepEqual(await (await ephemeralReceiptHandler(request())).json(), {
    ok: true,
    status: "DELETED",
  });
  assert.equal((await failingHandler(request())).status, 503);
});
