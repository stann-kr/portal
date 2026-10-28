import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAdminSession,
  assertAuthenticatedSession,
  assertOwnerOrAdmin,
  findStudentTarget,
  requireStudentOwnerOrAdmin,
  resolveActiveSession,
  resolveSignedInSession,
  type AuthSession,
} from "./auth-guard";
import type { ActiveProfile } from "./active-profile";

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

test("학생 대상은 활성 student profile만 허용한다", async () => {
  const student = createProfile("student-1", "student");
  const admin = createProfile("admin-1", "admin");

  assert.equal(
    await findStudentTarget("student-1", async () => student),
    student,
  );
  assert.equal(
    await findStudentTarget("admin-1", async () => admin),
    null,
  );
  assert.equal(
    await findStudentTarget("deleted-student", async () => null),
    null,
  );
  assert.equal(
    await findStudentTarget("unknown-student", async () => null),
    null,
  );
});

test("학생 대상 소유권 guard는 학생 본인과 관리자의 학생 접근만 통과시킨다", async () => {
  const student = createProfile("student-1", "student");
  const admin = createProfile("admin-1", "admin");

  await assert.doesNotReject(() =>
    requireStudentOwnerOrAdmin(
      createSession("student-1", "student"),
      "student-1",
      async () => student,
    ),
  );
  await assert.doesNotReject(() =>
    requireStudentOwnerOrAdmin(
      createSession("admin-1", "admin"),
      "student-1",
      async () => student,
    ),
  );
  await assert.rejects(
    () =>
      requireStudentOwnerOrAdmin(
        createSession("student-2", "student"),
        "student-1",
        async () => student,
      ),
    /Unauthorized/,
  );
  await assert.rejects(
    () =>
      requireStudentOwnerOrAdmin(
        createSession("admin-1", "admin"),
        "admin-1",
        async () => admin,
      ),
    /Student not found/,
  );
});

function createProfile(
  id: string,
  role: "admin" | "student",
): ActiveProfile {
  return {
    id,
    role,
    email: `${id}@db.example.com`,
    displayName: `DB ${role}`,
  };
}

test("매 요청 profile 존재를 확인해 삭제된 계정의 stale JWT를 거부한다", async () => {
  const stale = createSession("deleted-student", "student");
  const resolved = await resolveActiveSession(stale, async () => null);
  assert.equal(resolved, null);
});

test("JWT role 대신 현재 DB role과 profile 값을 사용한다", async () => {
  const staleRole = createSession("promoted-user", "student");
  const resolved = await resolveActiveSession(
    staleRole,
    async () => createProfile("promoted-user", "admin"),
  );

  assert.equal(resolved?.user.role, "admin");
  assert.equal(resolved?.user.email, "promoted-user@db.example.com");
  assert.equal(resolved?.user.name, "DB admin");
});

test("임시 비밀번호 session은 새 비밀번호를 정하기 전까지 포탈 인증으로 승격하지 않는다", async () => {
  const session = createSession("student-1", "student");
  session.user.passwordChangeRequired = true;
  const loadProfile = async () => createProfile("student-1", "student");

  assert.equal(await resolveActiveSession(session, loadProfile), null);
  const signedIn = await resolveSignedInSession(session, loadProfile);
  assert.equal(signedIn?.user.id, "student-1");
  assert.equal(signedIn?.user.passwordChangeRequired, true);
  assert.equal(await resolveSignedInSession(session, async () => null), null);
});
