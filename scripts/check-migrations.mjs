#!/usr/bin/env node

import { readdirSync } from "node:fs";
import {
  applyMigrations,
  createMemoryDatabase,
  migrationsDirectory,
  runDrizzleKit,
} from "./migration-check/runtime.mjs";
import { assert, assertRowsEqual } from "./migration-check/assertions.mjs";
import {
  databaseSignatures,
  normalizeDatabaseColumns,
  normalizeSnapshot,
  validateContinuityChecks,
  validateMetadata,
} from "./migration-check/schema.mjs";
import {
  validateContinuitySemantics,
  validateContinuityTriggers,
  validateContinuityUpgrade,
  validateLifecycleExpansionSemantics,
  validateLifecycleExpansionUpgrade,
} from "./migration-check/document-continuity.mjs";
import {
  validateServerDraftSemantics,
  validateServerDraftTriggers,
  validateServerDraftUpgrade,
} from "./migration-check/server-drafts.mjs";
import {
  validateMediaLifecycleSemantics,
  validateMediaLifecycleTriggers,
  validateMediaLifecycleUpgrade,
} from "./migration-check/media-lifecycle.mjs";
import {
  validateExternalCalendarSubscriptionSchema,
} from "./migration-check/external-calendar.mjs";
import {
  validateAccountPrivacyAtomicSource,
  validateAccountPrivacySemantics,
  validateAccountPrivacyUpgrade,
} from "./migration-check/account-privacy.mjs";

const migrationPattern = /^\d{4}_.+\.sql$/;

async function main() {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => migrationPattern.test(name))
    .sort();

  assert(migrationFiles.length > 0, "검증할 SQL migration이 없습니다.");
  const latestSnapshot = validateMetadata(migrationFiles);
  console.log(`PASS metadata mapping: SQL/journal/snapshot ${migrationFiles.length}개`);

  runDrizzleKit(["check", "--config", "drizzle.config.ts"]);
  console.log("PASS drizzle-kit metadata check");

  const migrationDatabase = await createMemoryDatabase();
  const schemaDatabase = await createMemoryDatabase();

  try {
    applyMigrations(migrationDatabase, migrationFiles);
    console.log(`PASS empty replay: ${migrationFiles.length}개 migration`);

    const schemaSql = runDrizzleKit([
      "export",
      "--dialect",
      "sqlite",
      "--schema",
      "./src/db/schema.ts",
    ]);
    schemaDatabase.exec("PRAGMA foreign_keys = ON;");
    schemaDatabase.exec(schemaSql);

    for (const signatureName of ["columns", "foreignKeys", "indexes"]) {
      const query = databaseSignatures[signatureName];
      assertRowsEqual(
        `migration replay ↔ current schema ${signatureName}`,
        migrationDatabase.all(query),
        schemaDatabase.all(query),
      );
    }
    console.log("PASS migration replay matches current schema: columns/foreign keys/indexes");

    const normalizedSnapshot = normalizeSnapshot(latestSnapshot);
    assertRowsEqual(
      "latest snapshot ↔ current schema columns",
      normalizedSnapshot.columns,
      normalizeDatabaseColumns(schemaDatabase.all(databaseSignatures.columns)),
    );
    assertRowsEqual(
      "latest snapshot ↔ current schema foreign keys",
      normalizedSnapshot.foreignKeys,
      schemaDatabase.all(databaseSignatures.foreignKeys),
    );
    assertRowsEqual(
      "latest snapshot ↔ current schema indexes",
      normalizedSnapshot.explicitIndexes,
      schemaDatabase.all(databaseSignatures.explicitIndexes),
    );
    console.log("PASS latest snapshot matches current schema");

    validateContinuityChecks(
      migrationDatabase,
      latestSnapshot,
      "migration replay",
    );
    validateContinuityChecks(
      schemaDatabase,
      latestSnapshot,
      "current schema",
    );
    validateContinuityTriggers(migrationDatabase);
    validateServerDraftTriggers(migrationDatabase);
    validateMediaLifecycleTriggers(migrationDatabase);
    validateExternalCalendarSubscriptionSchema(migrationDatabase);
    console.log("PASS document, server draft, media lifecycle CHECK/trigger signatures");

    validateContinuitySemantics(migrationDatabase);
    validateLifecycleExpansionSemantics(migrationDatabase);
    validateServerDraftSemantics(migrationDatabase);
    validateMediaLifecycleSemantics(migrationDatabase);
    validateAccountPrivacySemantics(migrationDatabase);
    validateAccountPrivacyAtomicSource();
    console.log("PASS document, server draft, media, account privacy semantic negative probes");

    const integrity = migrationDatabase.all("PRAGMA integrity_check;");
    const foreignKeyViolations = migrationDatabase.all("PRAGMA foreign_key_check;");
    assert(
      integrity.length === 1 && integrity[0].integrity_check === "ok",
      `SQLite integrity check 실패: ${JSON.stringify(integrity)}`,
    );
    assert(
      foreignKeyViolations.length === 0,
      `SQLite foreign key check 실패: ${JSON.stringify(foreignKeyViolations)}`,
    );
    console.log("PASS SQLite integrity/foreign key check");
  } finally {
    migrationDatabase.close();
    schemaDatabase.close();
  }

  await validateContinuityUpgrade(migrationFiles);
  console.log("PASS 0007 fixture upgrade and inbound FK preflight");
  await validateServerDraftUpgrade(migrationFiles);
  console.log("PASS 0008 fixture upgrade and server draft account cascade");
  await validateLifecycleExpansionUpgrade(migrationFiles);
  console.log("PASS 0009 fixture upgrade and post/Q&A continuity backfill");
  await validateMediaLifecycleUpgrade(migrationFiles);
  console.log("PASS 0010 populated fixture upgrade and media lifecycle additive columns");
  await validateAccountPrivacyUpgrade(migrationFiles);
  console.log("PASS populated 0011 → 0012 account privacy upgrade and rollback probes");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL migration consistency check\n${message}`);
  process.exitCode = 1;
}
