import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessCalendarFeed,
  createLegacyCalendarFeedToken,
  createOpaqueCalendarFeedToken,
  digestCalendarFeedToken,
  issueCalendarFeedToken,
  parseOpaqueCalendarFeedTokenDigest,
  verifyCalendarFeedToken,
  verifyLegacyCalendarFeedToken,
} from "./calendar-feed";

const TEST_SECRET = "calendar-feed-test-secret-at-least-32-chars";

function withAuthSecret<T>(secret: string | undefined, run: () => T): T {
  const previousSecret = process.env.AUTH_SECRET;
  if (secret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = secret;

  try {
    return run();
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
}

async function withAuthSecretAsync<T>(
  secret: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previousSecret = process.env.AUTH_SECRET;
  if (secret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = secret;

  try {
    return await run();
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
}

test("v2 token은 owner ID를 노출하지 않고 256-bit entropy를 요구한다", () => {
  const token = createOpaqueCalendarFeedToken(new Uint8Array(32).fill(7));
  assert.match(token, /^v2\.[A-Za-z0-9_-]{43}$/);
  assert.equal(token.includes("student-1"), false);
  assert.equal(parseOpaqueCalendarFeedTokenDigest(token), digestCalendarFeedToken(token));
  assert.equal(parseOpaqueCalendarFeedTokenDigest("v2.short"), null);
  assert.throws(
    () => createOpaqueCalendarFeedToken(new Uint8Array(31)),
    /exactly 32 bytes/,
  );
});

test("v2 raw token과 일치하는 DB digest만 허용한다", async () => {
  const token = createOpaqueCalendarFeedToken(new Uint8Array(32).fill(9));
  const digest = digestCalendarFeedToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/);

  assert.equal(
    await verifyCalendarFeedToken("student-1", token, async (ownerId) =>
      ownerId === "student-1" ? digest : null,
    ),
    true,
  );
  assert.equal(
    await verifyCalendarFeedToken("student-2", token, async () => null),
    false,
  );
  assert.equal(
    await verifyCalendarFeedToken("student-1", `${token.slice(0, -1)}A`, async () => digest),
    false,
  );
});

test("발급 writer에는 raw token이 아니라 digest만 전달한다", async () => {
  let writtenOwnerId = "";
  let writtenDigest = "";
  const token = await issueCalendarFeedToken(
    "student-1",
    async (ownerId, digest) => {
      writtenOwnerId = ownerId;
      writtenDigest = digest;
    },
    new Uint8Array(32).fill(11),
  );

  assert.equal(writtenOwnerId, "student-1");
  assert.equal(writtenDigest, digestCalendarFeedToken(token));
  assert.equal(writtenDigest.includes(token), false);
});

test("삭제되었거나 student가 아닌 owner는 유효 token이어도 거부한다", () => {
  assert.equal(canAccessCalendarFeed(null, null, true), false);
  assert.equal(
    canAccessCalendarFeed({ id: "admin-1", role: "admin" }, null, true),
    false,
  );
  assert.equal(
    canAccessCalendarFeed(
      { id: "student-1", role: "student" },
      { id: "student-1", role: "student" },
      false,
    ),
    true,
  );
});

test("형식 오류는 digest lookup 전에 거부한다", async () => {
  let lookupCount = 0;
  assert.equal(
    await verifyCalendarFeedToken("student-1", "v2.short", async () => {
      lookupCount += 1;
      return null;
    }),
    false,
  );
  assert.equal(lookupCount, 0);
});

test("legacy v1은 같은 학생과 AUTH_SECRET에만 호환된다", () => {
  withAuthSecret(TEST_SECRET, () => {
    const token = createLegacyCalendarFeedToken("student-1");
    assert.equal(verifyLegacyCalendarFeedToken("student-1", token), true);
    assert.equal(verifyLegacyCalendarFeedToken("student-2", token), false);
    assert.equal(verifyLegacyCalendarFeedToken("student-1", `${token}.extra`), false);
  });
});

test("owner가 v2를 발급한 뒤에는 기존 v1 token을 거부한다", async () => {
  await withAuthSecretAsync(TEST_SECRET, async () => {
    const token = createLegacyCalendarFeedToken("student-1");
    assert.equal(
      await verifyCalendarFeedToken("student-1", token, async () => null),
      true,
    );
    assert.equal(
      await verifyCalendarFeedToken(
        "student-1",
        token,
        async () => "a".repeat(64),
      ),
      false,
    );
  });
});

test("legacy v1은 AUTH_SECRET이 없거나 달라지면 허용하지 않는다", () => {
  const token = withAuthSecret(TEST_SECRET, () =>
    createLegacyCalendarFeedToken("student-1"),
  );
  withAuthSecret(undefined, () => {
    assert.throws(
      () => verifyLegacyCalendarFeedToken("student-1", token),
      /AUTH_SECRET is required/,
    );
  });
  withAuthSecret("different-secret-at-least-32-characters", () => {
    assert.equal(verifyLegacyCalendarFeedToken("student-1", token), false);
  });
});
