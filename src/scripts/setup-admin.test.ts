import assert from "node:assert/strict";
import test from "node:test";
import * as bcrypt from "bcryptjs";
import {
  assertNoCommandLineArguments,
  readAdminSeedConfig,
  seedAdmin,
  type AdminSeedConfig,
} from "./setup-admin";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  DEV_ADMIN_SEED_ENABLED: "true",
  DEV_ADMIN_EMAIL: "admin@example.com",
  DEV_ADMIN_PASSWORD: "local-password-only",
  DEV_ADMIN_DISPLAY_NAME: "Local Admin",
};

test("development 환경과 명시적 opt-in을 모두 요구한다", () => {
  assert.throws(
    () =>
      readAdminSeedConfig({
        ...validEnvironment,
        NODE_ENV: "production",
      }),
    /development/,
  );

  assert.throws(
    () =>
      readAdminSeedConfig({
        ...validEnvironment,
        DEV_ADMIN_SEED_ENABLED: "false",
      }),
    /DEV_ADMIN_SEED_ENABLED=true/,
  );
});

test("관리자 정보는 환경 변수에서만 읽고 유효성을 검사한다", () => {
  assert.deepEqual(readAdminSeedConfig(validEnvironment), {
    email: "admin@example.com",
    password: "local-password-only",
    displayName: "Local Admin",
  });

  assert.throws(
    () =>
      readAdminSeedConfig({
        ...validEnvironment,
        DEV_ADMIN_PASSWORD: "short",
      }),
    /12자 이상/,
  );

  assert.throws(
    () => assertNoCommandLineArguments(["admin@example.com", "password"]),
    /명령행 인자/,
  );
});

test("prepared statement에 값을 binding하고 비밀번호 원문을 남기지 않는다", async () => {
  const seed: AdminSeedConfig = {
    email: "admin@example.com",
    password: "local-password-only",
    displayName: "O'Brien'); DROP TABLE profiles; --",
  };
  let preparedQuery = "";
  let boundParameters: string[] = [];
  const database = {
    prepare(query: string) {
      preparedQuery = query;
      return {
        run(...parameters: string[]) {
          boundParameters = parameters;
        },
      };
    },
  };

  await seedAdmin(database, seed, "admin-id");

  assert.match(preparedQuery, /VALUES \(\?, \?, \?, \?, 'admin'\)/);
  assert.equal(preparedQuery.includes(seed.email), false);
  assert.equal(preparedQuery.includes(seed.displayName), false);
  assert.equal(boundParameters[0], "admin-id");
  assert.equal(boundParameters[1], seed.email);
  assert.notEqual(boundParameters[2], seed.password);
  assert.equal(boundParameters[3], seed.displayName);
  assert.equal(await bcrypt.compare(seed.password, boundParameters[2]), true);
});
