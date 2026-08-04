import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalendarFeedToken,
  verifyCalendarFeedToken,
} from "./calendar-feed";

const TEST_SECRET = "calendar-feed-test-secret-at-least-32-chars";

function withAuthSecret<T>(secret: string | undefined, run: () => T): T {
  const previousSecret = process.env.AUTH_SECRET;

  if (secret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = secret;
  }

  try {
    return run();
  } finally {
    if (previousSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previousSecret;
    }
  }
}

test("AUTH_SECRET이 없으면 token을 생성하지 않는다", () => {
  withAuthSecret(undefined, () => {
    assert.throws(
      () => createCalendarFeedToken("student-1"),
      /AUTH_SECRET is required/,
    );
  });
});

test("같은 학생과 secret으로 생성한 token을 허용한다", () => {
  withAuthSecret(TEST_SECRET, () => {
    const token = createCalendarFeedToken("student-1");
    assert.equal(verifyCalendarFeedToken("student-1", token), true);
  });
});

test("다른 학생의 token을 거부한다", () => {
  withAuthSecret(TEST_SECRET, () => {
    const token = createCalendarFeedToken("student-1");
    assert.equal(verifyCalendarFeedToken("student-2", token), false);
  });
});

test("변조되거나 형식이 잘못된 token을 거부한다", () => {
  withAuthSecret(TEST_SECRET, () => {
    const token = createCalendarFeedToken("student-1");
    const [version, studentId, signature] = token.split(".");

    assert.equal(verifyCalendarFeedToken("student-1", null), false);
    assert.equal(
      verifyCalendarFeedToken("student-1", `v2.${studentId}.${signature}`),
      false,
    );
    assert.equal(
      verifyCalendarFeedToken("student-1", `${version}.${studentId}.short`),
      false,
    );
    assert.equal(
      verifyCalendarFeedToken(
        "student-1",
        `${version}.${studentId}.${signature.slice(0, -1)}0`,
      ),
      false,
    );
  });
});

test("다른 secret으로 생성된 signature를 거부한다", () => {
  const token = withAuthSecret("first-secret-at-least-32-characters", () =>
    createCalendarFeedToken("student-1"),
  );

  withAuthSecret("second-secret-at-least-32-characters", () => {
    assert.equal(verifyCalendarFeedToken("student-1", token), false);
  });
});
