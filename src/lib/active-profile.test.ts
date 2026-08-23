import assert from "node:assert/strict";
import test from "node:test";
import {
  parseActiveLoginProfile,
  parseActiveProfile,
} from "./active-profile";

const profile = {
  id: "student-1",
  email: "student@example.com",
  displayName: "Student",
  passwordHash: "hash",
  role: "student",
};

test("profile row가 존재하고 role이 유효하면 active profile로 좁힌다", () => {
  assert.deepEqual(parseActiveProfile(profile), {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    role: profile.role,
  });
  assert.deepEqual(parseActiveLoginProfile(profile), profile);
});

test("삭제된 profile과 알 수 없는 role은 fail-closed 한다", () => {
  assert.equal(parseActiveProfile(undefined), null);
  assert.equal(parseActiveProfile({ ...profile, role: "owner" }), null);
});

test("후속 account status가 있으면 ACTIVE만 허용한다", () => {
  assert.deepEqual(parseActiveProfile({ ...profile, accountStatus: "ACTIVE" }), {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    role: profile.role,
  });
  assert.equal(
    parseActiveProfile({ ...profile, accountStatus: "PENDING_DELETE" }),
    null,
  );
  assert.equal(
    parseActiveProfile({ ...profile, account_status: "DELETED" }),
    null,
  );
});
