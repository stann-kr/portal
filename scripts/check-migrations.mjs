#!/usr/bin/env node

import { validateDocumentImageUpgrade } from "./migration-check/document-images.mjs";
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
  validateExternalCalendarSubscriptionUpgrade,
} from "./migration-check/external-calendar.mjs";
import {
  validateAssignmentTaskSchema,
  validateAssignmentTaskUpgrade,
} from "./migration-check/assignment-tasks.mjs";
import {
  validateGuidePageSchema,
  validateGuidePageUpgrade,
} from "./migration-check/guide-pages.mjs";
import { validateCalendarSyncUpgrade } from "./migration-check/calendar-sync.mjs";
import { validateCalendarPushChannelUpgrade } from "./migration-check/calendar-push-channels.mjs";
import { validateDiggingPlaylistUpgrade } from "./migration-check/digging-playlists.mjs";
import { validateCommentTimeMarkerUpgrade } from "./migration-check/comment-time-markers.mjs";
import { validateMixAnalysisUpgrade } from "./migration-check/mix-analysis.mjs";
import { validatePushSubscriptionsUpgrade } from "./migration-check/push-subscriptions.mjs";
import { validatePushMutedCategoriesUpgrade } from "./migration-check/push-muted-categories.mjs";
import { validateAssignmentReviewedAtUpgrade } from "./migration-check/assignment-reviewed-at.mjs";
import { validateGuideAccessUpgrade } from "./migration-check/guide-access.mjs";
import { validateLessonGroupsUpgrade } from "./migration-check/lesson-groups.mjs";
import { validateGroupNoteRetentionUpgrade } from "./migration-check/group-note-retention.mjs";
import { validateGroupCalendarUpgrade } from "./migration-check/group-calendar.mjs";
import { validateStudentArchiveUpgrade } from "./migration-check/student-archive.mjs";
import { validateCommentRepliesUpgrade } from "./migration-check/comment-replies.mjs";
import { validatePostReadsUpgrade } from "./migration-check/post-reads.mjs";
import { validateAssignmentDraftsUpgrade } from "./migration-check/assignment-drafts.mjs";
import { validateListQueryIndexesUpgrade } from "./migration-check/list-query-indexes.mjs";
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
    validateAssignmentTaskSchema(migrationDatabase);
    validateGuidePageSchema(migrationDatabase);
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
  await validateExternalCalendarSubscriptionUpgrade(migrationFiles);
  console.log("PASS populated 0012 → 0013 external calendar upgrade, constraints and owner cascade");
  await validateDocumentImageUpgrade(migrationFiles);
  console.log("PASS populated 0013 → 0014 document image upgrade, trigger rebuild and purpose constraints");
  await validateAssignmentTaskUpgrade(migrationFiles);
  console.log("PASS populated 0014 → 0015 assignment task upgrade, feedback preservation and occurrence uniqueness");
  await validateGuidePageUpgrade(migrationFiles);
  console.log("PASS populated 0015 → 0016 guide page upgrade, server draft rebuild and anchor preservation");
  await validateCalendarSyncUpgrade(migrationFiles);
  console.log("PASS populated 0016 → 0017 calendar sync tables, constraints and connection cascade");
  await validateCalendarPushChannelUpgrade(migrationFiles);
  console.log("PASS populated 0017 → 0018 calendar push channel table, constraints and mapping cascade");
  await validateDiggingPlaylistUpgrade(migrationFiles);
  console.log("PASS populated 0018 → 0019 digging playlist table, constraints and student cascade");
  await validateCommentTimeMarkerUpgrade(migrationFiles);
  console.log("PASS populated 0019 → 0020 comment time marker column, CHECK bounds and index without table rebuild");
  await validateMixAnalysisUpgrade(migrationFiles);
  console.log("PASS populated 0022 → 0023 mix analysis columns, CHECK bounds and row preservation without table rebuild");
  await validatePushSubscriptionsUpgrade(migrationFiles);
  console.log("PASS populated 0023 → 0024 push subscription table, endpoint uniqueness, CHECK bounds and profile cascade");
  await validatePushMutedCategoriesUpgrade(migrationFiles);
  console.log("PASS populated 0024 → 0025 push muted category table, category CHECK, pair uniqueness and profile cascade");
  await validateAssignmentReviewedAtUpgrade(migrationFiles);
  console.log("PASS populated 0025 → 0026 assignment reviewed_at nullable column and row preservation without table rebuild");
  await validateListQueryIndexesUpgrade(migrationFiles);
  console.log("PASS populated 0026 → 0027 list query indexes, schema and row preservation, index use by list queries");
  await validateGuideAccessUpgrade(migrationFiles);
  console.log("PASS populated 0027 → 0028 guide access tables, signed-up student backfill, constraints and cascades");
  await validateLessonGroupsUpgrade(migrationFiles);
  console.log("PASS populated 0028 → 0029 lesson group tables, nullable note group_id, constraints and cascades");
  await validateGroupNoteRetentionUpgrade(migrationFiles);
  console.log("PASS populated 0029 → 0030 tombstone group_id, group note image owner handoff only while the uploader account is ERASING");
  await validateGroupCalendarUpgrade(migrationFiles);
  console.log("PASS populated 0030 → 0031 group calendar mapping rebuild keeps sync links/series/channels, target CHECK, group unique and cascades");
  await validateStudentArchiveUpgrade(migrationFiles);
  console.log("PASS populated 0031 → 0032 profiles account_status ACTIVE default, archived_at nullable, archive/restore UPDATE through identity trigger, row preservation without table rebuild");
  await validateCommentRepliesUpgrade(migrationFiles);
  console.log("PASS populated 0032 → 0033 comments parent_id nullable without FK, parent index used, triggers and rows preserved, reply survives root delete");
  await validatePostReadsUpgrade(migrationFiles);
  console.log("PASS populated 0033 → 0034 post_reads table, composite key keeps first read, student index used, cascades on post delete and account FK, rows preserved");
  await validateAssignmentDraftsUpgrade(migrationFiles);
  console.log("PASS populated 0034 → 0035 assignment_drafts table, owner/key composite key, version compare-and-set, owner-task index used, cascades on task delete and account FK, rows preserved");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL migration consistency check\n${message}`);
  process.exitCode = 1;
}
