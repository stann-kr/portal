import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAdminSession,
  assertAuthenticatedSession,
  assertOwnerOrAdmin,
  type AuthSession,
} from "./auth-guard";

function createSession(
  id: string,
  role: "admin" | "student",
): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id,
      role,
      name: role === "admin" ? "Admin" : "Student",
      email: `${id}@example.com`,
      image: null,
    },
  };
}

test("미인증 또는 user id가 없는 세션을 거부한다", () => {
  assert.throws(() => assertAuthenticatedSession(null), /Unauthorized/);
  assert.throws(
    () =>
      assertAuthenticatedSession({
        expires: "2099-01-01T00:00:00.000Z",
        user: {
          role: "student",
          name: "Student",
          email: "student@example.com",
          image: null,
        },
      }),
    /Unauthorized/,
  );
});

test("user id가 있는 인증 세션을 그대로 반환한다", () => {
  const session = createSession("student-1", "student");
  assert.equal(assertAuthenticatedSession(session), session);
});

test("student의 관리자 접근을 거부하고 admin은 허용한다", () => {
  assert.throws(
    () => assertAdminSession(createSession("student-1", "student")),
    /Admin only/,
  );

  const admin = createSession("admin-1", "admin");
  assert.equal(assertAdminSession(admin), admin);
});

test("student는 본인 데이터만 접근할 수 있다", () => {
  const student = createSession("student-1", "student");

  assert.doesNotThrow(() => assertOwnerOrAdmin(student, "student-1"));
  assert.throws(
    () => assertOwnerOrAdmin(student, "student-2"),
    /Unauthorized/,
  );
});

test("admin은 다른 사용자의 데이터에 접근할 수 있다", () => {
  const admin = createSession("admin-1", "admin");
  assert.doesNotThrow(() => assertOwnerOrAdmin(admin, "student-1"));
});
