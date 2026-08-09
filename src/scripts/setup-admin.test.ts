import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as bcrypt from "bcryptjs";
import Database from "better-sqlite3";
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
  const preparedQueries: string[] = [];
  const boundParameterSets: string[][] = [];
  const database = {
    prepare(query: string) {
      preparedQueries.push(query);
      return {
        run(...parameters: string[]) {
          boundParameterSets.push(parameters);
        },
      };
    },
    transaction<Result>(operation: () => Result) {
      return operation;
    },
  };

  await seedAdmin(database, seed, "admin-id");

  assert.equal(preparedQueries.length, 2);
  assert.match(preparedQueries[0], /UPDATE profiles/);
  assert.match(preparedQueries[1], /WHERE NOT EXISTS/);
  for (const preparedQuery of preparedQueries) {
    assert.equal(preparedQuery.includes(seed.email), false);
    assert.equal(preparedQuery.includes(seed.displayName), false);
  }
  assert.equal(boundParameterSets[0][1], seed.email);
  assert.equal(boundParameterSets[1][0], "admin-id");
  assert.equal(boundParameterSets[1][1], seed.email);
  assert.notEqual(boundParameterSets[1][2], seed.password);
  assert.equal(boundParameterSets[1][3], seed.displayName);
  assert.equal(boundParameterSets[1][4], seed.email);
  assert.equal(
    await bcrypt.compare(seed.password, boundParameterSets[1][2]),
    true,
  );
});

test("0012 profile identity guard와 함께 관리자 seed insert/update가 동작한다", async (context) => {
  const database = new Database(":memory:");
  context.after(() => database.close());
  database.pragma("foreign_keys = ON");
  for (const migrationFile of readdirSync(join(process.cwd(), "drizzle"))
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    database.exec(readFileSync(join(process.cwd(), "drizzle", migrationFile), "utf8"));
  }

  await seedAdmin(database, readAdminSeedConfig(validEnvironment), "seed-admin-id");
  const rotatedSeed = {
    email: validEnvironment.DEV_ADMIN_EMAIL!,
    password: "rotated-local-password",
    displayName: "Ignored replacement name",
  };
  await seedAdmin(database, rotatedSeed, "replacement-id-must-not-be-used");

  const rows = database
    .prepare(`
      SELECT id, email, password_hash, display_name, role
      FROM profiles
      WHERE email = ?
    `)
    .all(rotatedSeed.email) as Array<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      role: string;
    }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "seed-admin-id");
  assert.equal(rows[0].role, "admin");
  assert.equal(rows[0].display_name, validEnvironment.DEV_ADMIN_DISPLAY_NAME);
  assert.equal(await bcrypt.compare(rotatedSeed.password, rows[0].password_hash), true);
});
