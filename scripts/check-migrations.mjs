#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const migrationsDirectory = join(repositoryRoot, "drizzle");
const metadataDirectory = join(migrationsDirectory, "meta");
const journalPath = join(metadataDirectory, "_journal.json");
const drizzleKitCli = join(repositoryRoot, "node_modules", "drizzle-kit", "bin.cjs");

const migrationPattern = /^\d{4}_.+\.sql$/;
const snapshotPattern = /^\d{4}_snapshot\.json$/;
const zeroSnapshotId = "00000000-0000-0000-0000-000000000000";
const continuityMigrationFile = "0008_document_continuity.sql";
const serverDraftMigrationFile = "0009_document_server_drafts.sql";
const lifecycleExpansionMigrationFile = "0010_post_qna_lifecycle.sql";
const continuityTables = [
  "document_operation_ledger",
  "document_server_draft_operations",
  "document_server_drafts",
  "document_tombstones",
  "private_notes",
  "private_note_revisions",
  "post_revisions",
  "posts",
  "qna_thread_events",
  "qna_threads",
];
const continuityCheckNames = {
  document_operation_ledger: [
    "document_operation_ledger_nonempty_ids_check",
    "document_operation_ledger_operation_type_check",
    "document_operation_ledger_request_hash_check",
    "document_operation_ledger_resource_operation_check",
    "document_operation_ledger_resource_type_check",
    "document_operation_ledger_result_revision_check",
  ],
  document_server_draft_operations: [
    "document_server_draft_operations_hash_check",
    "document_server_draft_operations_identity_check",
    "document_server_draft_operations_state_check",
    "document_server_draft_operations_timestamp_check",
    "document_server_draft_operations_type_check",
  ],
  document_server_drafts: [
    "document_server_drafts_identity_check",
    "document_server_drafts_kind_check",
    "document_server_drafts_payload_check",
    "document_server_drafts_timestamp_check",
    "document_server_drafts_version_check",
  ],
  document_tombstones: [
    "document_tombstones_nonempty_ids_check",
    "document_tombstones_resource_type_check",
    "document_tombstones_source_version_check",
  ],
  private_notes: [
    "private_notes_deleted_actor_check",
    "private_notes_version_check",
  ],
  private_note_revisions: [
    "private_note_revisions_change_type_check",
    "private_note_revisions_deleted_state_check",
    "private_note_revisions_identity_check",
    "private_note_revisions_initial_number_check",
    "private_note_revisions_number_check",
    "private_note_revisions_restore_source_check",
  ],
  post_revisions: [
    "post_revisions_change_type_check",
    "post_revisions_deleted_state_check",
    "post_revisions_identity_check",
    "post_revisions_initial_number_check",
    "post_revisions_number_check",
    "post_revisions_restore_source_check",
  ],
  posts: ["posts_version_check"],
  qna_thread_events: [
    "qna_thread_events_deleted_state_check",
    "qna_thread_events_identity_check",
    "qna_thread_events_initial_number_check",
    "qna_thread_events_number_check",
    "qna_thread_events_reply_check",
    "qna_thread_events_status_check",
    "qna_thread_events_type_check",
  ],
  qna_threads: ["qna_threads_version_check"],
};
const continuityTriggerNames = [
  "document_batch_abort_guard_reject_insert",
  "document_operation_ledger_before_insert_existing",
  "document_operation_ledger_immutable_delete",
  "document_operation_ledger_immutable_update",
  "document_tombstones_before_insert_existing",
  "document_tombstones_immutable_delete",
  "document_tombstones_immutable_update",
  "private_note_revisions_before_insert_baseline",
  "private_note_revisions_before_insert_existing",
  "private_note_revisions_before_insert_receipt_match",
  "private_note_revisions_guard_delete",
  "private_note_revisions_immutable_update",
  "private_notes_before_delete_tombstone",
  "private_notes_before_insert_tombstone",
  "post_revisions_before_insert_baseline",
  "post_revisions_before_insert_existing",
  "post_revisions_before_insert_receipt_match",
  "post_revisions_guard_delete",
  "post_revisions_immutable_update",
  "posts_before_delete_tombstone",
  "posts_before_insert_tombstone",
  "posts_deleted_actor_guard_insert",
  "posts_deleted_actor_guard_update",
  "qna_replies_before_insert_existing",
  "qna_replies_before_insert_receipt_match",
  "qna_replies_guard_delete",
  "qna_replies_immutable_update",
  "qna_thread_events_before_insert_baseline",
  "qna_thread_events_before_insert_existing",
  "qna_thread_events_before_insert_receipt_match",
  "qna_thread_events_guard_delete",
  "qna_thread_events_immutable_update",
  "qna_threads_before_delete_tombstone",
  "qna_threads_before_insert_tombstone",
  "qna_threads_deleted_actor_guard_insert",
  "qna_threads_deleted_actor_guard_update",
  "comments_before_delete_trashed_post",
  "comments_before_insert_active_post",
  "comments_before_update_trashed_post",
  "profiles_before_delete_document_history",
];
const serverDraftTriggerNames = [
  "document_server_draft_operations_before_insert_existing",
  "document_server_draft_operations_immutable_update",
  "document_server_drafts_before_insert_existing",
  "document_server_drafts_cas_update_guard",
];

const databaseSignatures = {
  columns: `
    SELECT m.name AS table_name,
           p.name AS column_name,
           lower(p.type) AS type,
           p."notnull" AS not_null,
           coalesce(p.dflt_value, '') AS default_value,
           p.pk AS primary_key
    FROM sqlite_master AS m
    JOIN pragma_table_info(m.name) AS p
    WHERE m.type = 'table'
      AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, p.name
  `,
  foreignKeys: `
    SELECT m.name AS table_name,
           fk."table" AS referenced_table,
           fk."from" AS source_column,
           fk."to" AS target_column,
           lower(fk.on_update) AS on_update,
           lower(fk.on_delete) AS on_delete,
           lower(fk.match) AS match_mode
    FROM sqlite_master AS m
    JOIN pragma_foreign_key_list(m.name) AS fk
    WHERE m.type = 'table'
      AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, fk."table", fk."from", fk."to"
  `,
  indexes: `
    SELECT m.name AS table_name,
           il.name AS index_name,
           il."unique" AS is_unique,
           il.origin AS origin,
           ii.seqno AS column_order,
           ii.name AS column_name
    FROM sqlite_master AS m
    JOIN pragma_index_list(m.name) AS il
    JOIN pragma_index_info(il.name) AS ii
    WHERE m.type = 'table'
      AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, il.name, ii.seqno
  `,
  explicitIndexes: `
    SELECT m.name AS table_name,
           il.name AS index_name,
           il."unique" AS is_unique,
           il.origin AS origin,
           ii.seqno AS column_order,
           ii.name AS column_name
    FROM sqlite_master AS m
    JOIN pragma_index_list(m.name) AS il
    JOIN pragma_index_info(il.name) AS ii
    WHERE m.type = 'table'
      AND m.name NOT LIKE 'sqlite_%'
      AND il.origin = 'c'
    ORDER BY m.name, il.name, ii.seqno
  `,
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stringifyRows(rows) {
  return JSON.stringify(rows);
}

function assertRowsEqual(label, actual, expected) {
  if (stringifyRows(actual) !== stringifyRows(expected)) {
    const differenceIndex = Array.from(
      { length: Math.max(actual.length, expected.length) },
      (_, index) => index,
    ).find((index) => stringifyRows(actual[index]) !== stringifyRows(expected[index]));

    throw new Error(
      `${label} 불일치 (index ${differenceIndex}, actual ${actual.length}개, expected ${expected.length}개)` +
        `\nactual=${JSON.stringify(actual[differenceIndex], null, 2)}` +
        `\nexpected=${JSON.stringify(expected[differenceIndex], null, 2)}`,
    );
  }
}

function hasWrappingParentheses(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return false;
  }

  let depth = 0;
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (quoted) {
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;

      if (depth === 0 && index < value.length - 1) {
        return false;
      }
    }
  }

  return depth === 0 && !quoted;
}

function normalizeDefaultValue(value) {
  let normalized = value === undefined || value === null ? "" : String(value).trim();

  while (hasWrappingParentheses(normalized)) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
}

function normalizeDatabaseColumns(columns) {
  return columns.map((column) => ({
    ...column,
    default_value: normalizeDefaultValue(column.default_value),
  }));
}

function normalizeSqlSignature(value, tableName = "") {
  let normalized = String(value ?? "")
    .replaceAll("`", "")
    .replaceAll('"', "")
    .trim()
    .replace(/;$/u, "")
    .toLowerCase();
  if (tableName) {
    normalized = normalized.replaceAll(`${tableName.toLowerCase()}.`, "");
  }
  return normalized
    .replace(/\s+/gu, " ")
    .replace(/\s*(>=|<=|<>|!=|=|>|<)\s*/gu, "$1")
    .replace(/\s*([(),])\s*/gu, "$1")
    .trim();
}

function compareText(left, right) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

async function createMemoryDatabase() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");

    return {
      exec: (sql) => database.exec(sql),
      all: (sql) => database.prepare(sql).all(),
      close: () => database.close(),
    };
  } catch (nodeSqliteError) {
    try {
      const { default: BetterSqlite3 } = await import("better-sqlite3");
      const database = new BetterSqlite3(":memory:");

      return {
        exec: (sql) => database.exec(sql),
        all: (sql) => database.prepare(sql).all(),
        close: () => database.close(),
      };
    } catch (betterSqliteError) {
      throw new AggregateError(
        [nodeSqliteError, betterSqliteError],
        "사용 가능한 in-memory SQLite driver가 없습니다.",
      );
    }
  }
}

function validateMetadata(migrationFiles) {
  const journal = readJson(journalPath);
  const entries = journal.entries;
  const snapshotFiles = readdirSync(metadataDirectory)
    .filter((name) => snapshotPattern.test(name))
    .sort();

  assert(journal.dialect === "sqlite", "Drizzle journal dialect가 sqlite가 아닙니다.");
  assert(Array.isArray(entries), "Drizzle journal entries가 배열이 아닙니다.");
  assert(
    entries.length === migrationFiles.length,
    `SQL ${migrationFiles.length}개와 journal entry ${entries.length}개가 일치하지 않습니다.`,
  );
  assert(
    snapshotFiles.length === entries.length,
    `snapshot ${snapshotFiles.length}개와 journal entry ${entries.length}개가 일치하지 않습니다.`,
  );

  let previousSnapshotId = zeroSnapshotId;
  let previousTimestamp = 0;
  const snapshotIds = new Set();
  let latestSnapshot;

  entries.forEach((entry, position) => {
    const prefix = String(position).padStart(4, "0");
    const expectedMigration = `${entry.tag}.sql`;
    const expectedSnapshot = `${prefix}_snapshot.json`;

    assert(entry.idx === position, `journal idx ${entry.idx}가 예상 순서 ${position}와 다릅니다.`);
    assert(
      migrationFiles[position] === expectedMigration,
      `journal tag ${entry.tag}와 SQL ${migrationFiles[position]}가 대응하지 않습니다.`,
    );
    assert(
      snapshotFiles[position] === expectedSnapshot,
      `journal idx ${position}와 snapshot ${snapshotFiles[position]}가 대응하지 않습니다.`,
    );
    assert(
      Number.isInteger(entry.when) && entry.when > previousTimestamp,
      `journal timestamp가 idx ${position}에서 증가하지 않습니다.`,
    );

    const snapshot = readJson(join(metadataDirectory, expectedSnapshot));
    assert(snapshot.version === entry.version, `${expectedSnapshot} version이 journal과 다릅니다.`);
    assert(snapshot.prevId === previousSnapshotId, `${expectedSnapshot} prevId chain이 끊겼습니다.`);
    assert(!snapshotIds.has(snapshot.id), `${expectedSnapshot} id가 중복됩니다.`);

    snapshotIds.add(snapshot.id);
    previousSnapshotId = snapshot.id;
    previousTimestamp = entry.when;
    latestSnapshot = snapshot;
  });

  return latestSnapshot;
}

function applyMigration(database, migrationFile) {
  const sql = readFileSync(join(migrationsDirectory, migrationFile), "utf8");
  database.exec("BEGIN;");

  try {
    database.exec(sql);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${migrationFile} 적용 실패: ${message}`);
  }
}

function applyMigrations(database, migrationFiles) {
  database.exec("PRAGMA foreign_keys = ON;");
  for (const migrationFile of migrationFiles) {
    applyMigration(database, migrationFile);
  }
}

function runDrizzleKit(args) {
  try {
    return execFileSync(process.execPath, [drizzleKitCli, ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stdout = error?.stdout?.toString().trim();
    const stderr = error?.stderr?.toString().trim();
    throw new Error(["Drizzle Kit 실행 실패", stdout, stderr].filter(Boolean).join("\n"));
  }
}

function normalizeSnapshot(snapshot) {
  const columns = [];
  const foreignKeys = [];
  const explicitIndexes = [];

  for (const table of Object.values(snapshot.tables)) {
    const compositePrimaryKeyPositions = new Map();
    for (const primaryKey of Object.values(table.compositePrimaryKeys ?? {})) {
      primaryKey.columns.forEach((columnName, columnIndex) => {
        compositePrimaryKeyPositions.set(columnName, columnIndex + 1);
      });
    }

    for (const column of Object.values(table.columns)) {
      columns.push({
        table_name: table.name,
        column_name: column.name,
        type: column.type.toLowerCase(),
        not_null: Number(column.notNull),
        default_value: normalizeDefaultValue(column.default),
        primary_key:
          compositePrimaryKeyPositions.get(column.name) ?? Number(column.primaryKey),
      });
    }

    for (const foreignKey of Object.values(table.foreignKeys)) {
      foreignKey.columnsFrom.forEach((sourceColumn, columnIndex) => {
        foreignKeys.push({
          table_name: table.name,
          referenced_table: foreignKey.tableTo,
          source_column: sourceColumn,
          target_column: foreignKey.columnsTo[columnIndex],
          on_update: (foreignKey.onUpdate ?? "no action").toLowerCase(),
          on_delete: (foreignKey.onDelete ?? "no action").toLowerCase(),
          match_mode: "none",
        });
      });
    }

    for (const index of Object.values(table.indexes)) {
      index.columns.forEach((column, columnOrder) => {
        assert(typeof column === "string", `${index.name}에 지원하지 않는 expression index가 있습니다.`);
        explicitIndexes.push({
          table_name: table.name,
          index_name: index.name,
          is_unique: Number(index.isUnique),
          origin: "c",
          column_order: columnOrder,
          column_name: column,
        });
      });
    }
  }

  columns.sort((left, right) =>
    compareText(`${left.table_name}\0${left.column_name}`, `${right.table_name}\0${right.column_name}`),
  );
  foreignKeys.sort((left, right) =>
    compareText(
      `${left.table_name}\0${left.referenced_table}\0${left.source_column}\0${left.target_column}`,
      `${right.table_name}\0${right.referenced_table}\0${right.source_column}\0${right.target_column}`,
    ),
  );
  explicitIndexes.sort((left, right) =>
    compareText(
      `${left.table_name}\0${left.index_name}\0${left.column_order}`,
      `${right.table_name}\0${right.index_name}\0${right.column_order}`,
    ),
  );

  return { columns, foreignKeys, explicitIndexes };
}

function assertSqlFails(database, sql, label, expectedMessage) {
  let failure = null;
  try {
    database.exec(sql);
  } catch (error) {
    failure = error;
  }

  assert(failure, `${label}: 실패해야 하는 SQL이 성공했습니다.`);
  if (expectedMessage) {
    const message = failure instanceof Error ? failure.message : String(failure);
    assert(
      message.includes(expectedMessage),
      `${label}: 예상 오류 ${expectedMessage}를 찾지 못했습니다. actual=${message}`,
    );
  }
}

function validateContinuityChecks(database, latestSnapshot, label) {
  const tableRows = database.all(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (${continuityTables.map((name) => `'${name}'`).join(", ")})
    ORDER BY name
  `);
  assert(
    tableRows.length === continuityTables.length,
    `${label}: continuity table CREATE SQL을 모두 찾지 못했습니다.`,
  );
  const tableSqlByName = new Map(tableRows.map((row) => [row.name, row.sql]));

  for (const tableName of continuityTables) {
    const snapshotTable = latestSnapshot.tables[tableName];
    assert(snapshotTable, `${label}: snapshot에서 ${tableName}을 찾지 못했습니다.`);
    const checks = Object.values(snapshotTable.checkConstraints ?? {});
    const actualNames = checks.map((check) => check.name).sort();
    const expectedNames = [...continuityCheckNames[tableName]].sort();
    assertRowsEqual(`${label}: ${tableName} CHECK allowlist`, actualNames, expectedNames);

    const normalizedCreateSql = normalizeSqlSignature(
      tableSqlByName.get(tableName),
      tableName,
    );
    for (const check of checks) {
      const expectedFragment = normalizeSqlSignature(
        `CONSTRAINT ${check.name} CHECK(${check.value})`,
        tableName,
      );
      assert(
        normalizedCreateSql.includes(expectedFragment),
        `${label}: ${tableName}.${check.name} CHECK 식이 snapshot과 다릅니다.`,
      );
    }
  }
}

function validateContinuityTriggers(database) {
  const triggerRows = database.all(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name IN (
        'comments',
        'document_batch_abort_guard',
        'document_operation_ledger',
        'document_tombstones',
        'post_revisions',
        'posts',
        'profiles',
        'private_notes',
        'private_note_revisions',
        'qna_replies',
        'qna_thread_events',
        'qna_threads'
      )
    ORDER BY name
  `);
  assertRowsEqual(
    "continuity trigger allowlist",
    triggerRows.map((row) => row.name),
    [...continuityTriggerNames].sort(),
  );

  const sourceByName = new Map();
  for (const migrationFile of [
    continuityMigrationFile,
    lifecycleExpansionMigrationFile,
  ]) {
    const migrationStatements = readFileSync(
      join(migrationsDirectory, migrationFile),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => /^CREATE TRIGGER\b/iu.test(statement));
    for (const statement of migrationStatements) {
      const match = statement.match(/^CREATE TRIGGER\s+[`"]?([^`"\s]+)[`"]?/iu);
      assert(match, `${migrationFile} trigger 이름을 해석하지 못했습니다.`);
      if (continuityTriggerNames.includes(match[1])) {
        sourceByName.set(match[1], normalizeSqlSignature(statement));
      }
    }
  }
  assertRowsEqual(
    "document lifecycle trigger source allowlist",
    [...sourceByName.keys()].sort(),
    [...continuityTriggerNames].sort(),
  );
  for (const trigger of triggerRows) {
    assert(
      normalizeSqlSignature(trigger.sql) === sourceByName.get(trigger.name),
      `${trigger.name} trigger SQL이 migration source와 다릅니다.`,
    );
  }
}

function validateServerDraftTriggers(database) {
  const triggerRows = database.all(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name IN (
        'document_server_draft_operations',
        'document_server_drafts'
      )
    ORDER BY name
  `);
  assertRowsEqual(
    "server draft trigger allowlist",
    triggerRows.map((row) => row.name),
    [...serverDraftTriggerNames].sort(),
  );

  const migrationStatements = readFileSync(
    join(migrationsDirectory, serverDraftMigrationFile),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => /^CREATE TRIGGER\b/iu.test(statement));
  const sourceByName = new Map();
  for (const statement of migrationStatements) {
    const match = statement.match(/^CREATE TRIGGER\s+[`"]?([^`"\s]+)[`"]?/iu);
    assert(match, "0009 trigger 이름을 해석하지 못했습니다.");
    sourceByName.set(match[1], normalizeSqlSignature(statement));
  }
  assertRowsEqual(
    "0009 trigger source allowlist",
    [...sourceByName.keys()].sort(),
    [...serverDraftTriggerNames].sort(),
  );
  for (const trigger of triggerRows) {
    assert(
      normalizeSqlSignature(trigger.sql) === sourceByName.get(trigger.name),
      `${trigger.name} trigger SQL이 0009 source와 다릅니다.`,
    );
  }
}

async function validateContinuityUpgrade(migrationFiles) {
  const continuityIndex = migrationFiles.indexOf(continuityMigrationFile);
  assert(continuityIndex > 0, `${continuityMigrationFile} 순서를 찾지 못했습니다.`);
  const priorMigrations = migrationFiles.slice(0, continuityIndex);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, priorMigrations);
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES
        ('upgrade-student', 'upgrade-student@example.com', 'Upgrade Student', 'student'),
        ('upgrade-admin', 'upgrade-admin@example.com', 'Upgrade Admin', 'admin');
      INSERT INTO private_notes (
        id, student_id, author_id, title, content_html, created_at, note_date
      ) VALUES
        ('upgrade-known-date', 'upgrade-student', 'upgrade-admin', 'Known', '<p>Known</p>', 1700000000, 1700000100),
        ('upgrade-null-date', 'upgrade-student', 'upgrade-student', 'Null', '<p>Null</p>', NULL, NULL);
    `);
    applyMigration(upgradeDatabase, continuityMigrationFile);

    const heads = upgradeDatabase.all(`
      SELECT id, version, deleted_at, created_at, updated_at
      FROM private_notes
      ORDER BY id
    `);
    assert(heads.length === 2, "0007 fixture head 개수가 보존되지 않았습니다.");
    assert(
      heads.every(
        (head) =>
          head.version === 1 &&
          head.deleted_at === null &&
          head.created_at !== null &&
          head.created_at === head.updated_at,
      ),
      "0007 fixture의 version/timestamp/active backfill이 올바르지 않습니다.",
    );
    const baselines = upgradeDatabase.all(`
      SELECT note_id, revision_number, change_type, snapshot_hash,
             snapshot_hash_version, actor_id, operation_record_id
      FROM private_note_revisions
      ORDER BY note_id
    `);
    assert(
      baselines.length === 2 &&
        baselines.every(
          (revision) =>
            revision.revision_number === 1 &&
            revision.change_type === "BASELINE" &&
            revision.snapshot_hash === null &&
            revision.snapshot_hash_version === null &&
            revision.actor_id === null &&
            revision.operation_record_id === null,
        ),
      "0007 fixture마다 BASELINE revision이 정확히 생성되지 않았습니다.",
    );
    assertSqlFails(
      upgradeDatabase,
      "DELETE FROM profiles WHERE id = 'upgrade-student';",
      "private note 보유 profile RESTRICT",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0007 upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }

  const inboundDatabase = await createMemoryDatabase();
  try {
    applyMigrations(inboundDatabase, priorMigrations);
    inboundDatabase.exec(`
      INSERT INTO profiles (id, email, role)
      VALUES ('inbound-student', 'inbound-student@example.com', 'student');
      INSERT INTO private_notes (id, student_id, author_id, title, content_html)
      VALUES ('inbound-note', 'inbound-student', 'inbound-student', 'Inbound', '<p>Inbound</p>');
      CREATE TABLE private_note_children (
        id TEXT PRIMARY KEY NOT NULL,
        note_id TEXT NOT NULL REFERENCES private_notes(id) ON DELETE RESTRICT
      );
      INSERT INTO private_note_children (id, note_id)
      VALUES ('inbound-child', 'inbound-note');
    `);
    let migrationFailure = null;
    try {
      applyMigration(inboundDatabase, continuityMigrationFile);
    } catch (error) {
      migrationFailure = error;
    }
    assert(migrationFailure, "private_notes inbound FK preflight가 migration을 중단하지 않았습니다.");
    const failureMessage =
      migrationFailure instanceof Error
        ? migrationFailure.message
        : String(migrationFailure);
    assert(
      failureMessage.includes("DOCUMENT_BATCH_ABORT"),
      `inbound FK preflight 오류가 예상과 다릅니다: ${failureMessage}`,
    );
    const columns = inboundDatabase.all("PRAGMA table_info('private_notes');");
    assert(
      !columns.some((column) => column.name === "version"),
      "inbound FK preflight 실패 뒤 private_notes rebuild가 일부 반영되었습니다.",
    );
    assert(
      inboundDatabase.all("SELECT id FROM private_note_children;").length === 1,
      "inbound FK preflight 실패가 child fixture를 변경했습니다.",
    );
  } finally {
    inboundDatabase.close();
  }
}

async function validateServerDraftUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(serverDraftMigrationFile);
  assert(migrationIndex > 0, `${serverDraftMigrationFile} 순서를 찾지 못했습니다.`);
  const priorMigrations = migrationFiles.slice(0, migrationIndex);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, priorMigrations);
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES ('server-draft-upgrade-user', 'server-draft-upgrade@example.com', 'Server Draft', 'student');
    `);
    applyMigration(upgradeDatabase, serverDraftMigrationFile);
    assert(
      upgradeDatabase.all(
        "SELECT id FROM profiles WHERE id = 'server-draft-upgrade-user';",
      ).length === 1,
      "0009 upgrade가 기존 profile을 변경했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT * FROM document_server_drafts;").length === 0 &&
        upgradeDatabase.all("SELECT * FROM document_server_draft_operations;").length === 0,
      "0009 신규 server draft table이 비어 있지 않습니다.",
    );

    const hash = "a".repeat(64);
    upgradeDatabase.exec(`
      INSERT INTO document_server_drafts (
        owner_id, source_key, document_kind, context_id, payload_json,
        payload_hash, draft_version, writer_device_id,
        created_at, updated_at, expires_at
      ) VALUES (
        'server-draft-upgrade-user',
        'draft:document:note:server-draft-upgrade-user:new',
        'note', 'new', '{"title":"upgrade"}', '${hash}', 1,
        '00000000-0000-4000-8000-000000000001',
        1700000000, 1700000000, 1702592000
      );
      INSERT INTO document_server_draft_operations (
        owner_id, operation_id, source_key, operation_type, request_hash,
        request_hash_version, result_version, result_state, created_at, expires_at
      ) VALUES (
        'server-draft-upgrade-user',
        '00000000-0000-4000-8000-000000000002',
        'draft:document:note:server-draft-upgrade-user:new',
        'UPSERT', '${hash}', 1, 1, 'PRESENT', 1700000000, 1702592000
      );
      DELETE FROM profiles WHERE id = 'server-draft-upgrade-user';
    `);
    assert(
      upgradeDatabase.all("SELECT * FROM document_server_drafts;").length === 0 &&
        upgradeDatabase.all("SELECT * FROM document_server_draft_operations;").length === 0,
      "profile 삭제가 server draft payload와 receipt를 cascade하지 않았습니다.",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0009 upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }
}

async function validateLifecycleExpansionUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(lifecycleExpansionMigrationFile);
  assert(migrationIndex > 0, `${lifecycleExpansionMigrationFile} 순서를 찾지 못했습니다.`);
  const priorMigrations = migrationFiles.slice(0, migrationIndex);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, priorMigrations);
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES
        ('lifecycle-student', 'lifecycle-student@example.com', 'Lifecycle Student', 'student'),
        ('lifecycle-admin', 'lifecycle-admin@example.com', 'Lifecycle Admin', 'admin');
      INSERT INTO posts (
        id, author_id, category, board_type, is_pinned, media_url,
        title, content_html, created_at
      ) VALUES (
        'lifecycle-post', 'lifecycle-admin', 'general', 'ANNOUNCEMENT', 1,
        'https://example.com/post-media', 'Lifecycle Post', '<p>Post</p>', 1700000000
      );
      INSERT INTO comments (id, post_id, author_id, content_html, created_at)
      VALUES (
        'lifecycle-comment', 'lifecycle-post', 'lifecycle-student',
        '<p>Comment</p>', 1700000001
      );
      INSERT INTO qna_threads (
        id, student_id, title, status, created_at, updated_at
      ) VALUES (
        'lifecycle-thread', 'lifecycle-student', 'Lifecycle Q&A',
        'ANSWERED', 1700000000, 1700000002
      );
      INSERT INTO qna_replies (
        id, thread_id, author_id, content_html, attachment_url, created_at
      ) VALUES
        ('lifecycle-question', 'lifecycle-thread', 'lifecycle-student', '<p>Question</p>', NULL, 1700000000),
        ('lifecycle-answer', 'lifecycle-thread', 'lifecycle-admin', '<p>Answer</p>', NULL, 1700000002);
    `);

    applyMigration(upgradeDatabase, lifecycleExpansionMigrationFile);

    const [post] = upgradeDatabase.all(`
      SELECT version, deleted_at, updated_at FROM posts WHERE id = 'lifecycle-post';
    `);
    assert(
      post?.version === 1 && post?.deleted_at === null && post?.updated_at === 1700000000,
      "0010 upgrade가 기존 post head를 active version 1로 backfill하지 못했습니다.",
    );
    const [postBaseline] = upgradeDatabase.all(`
      SELECT revision_number, change_type, board_type, category, is_pinned, media_url,
             actor_id, operation_record_id
      FROM post_revisions WHERE post_id = 'lifecycle-post';
    `);
    assert(
      postBaseline?.revision_number === 1 &&
        postBaseline?.change_type === "BASELINE" &&
        postBaseline?.board_type === "ANNOUNCEMENT" &&
        postBaseline?.category === "general" &&
        postBaseline?.is_pinned === 1 &&
        postBaseline?.media_url === "https://example.com/post-media" &&
        postBaseline?.actor_id === null &&
        postBaseline?.operation_record_id === null,
      "0010 upgrade가 기존 post의 완전한 BASELINE snapshot을 만들지 못했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT id FROM comments WHERE id = 'lifecycle-comment';").length === 1,
      "0010 upgrade가 기존 post comment를 보존하지 못했습니다.",
    );

    const [thread] = upgradeDatabase.all(`
      SELECT version, deleted_at, status FROM qna_threads WHERE id = 'lifecycle-thread';
    `);
    const [threadBaseline] = upgradeDatabase.all(`
      SELECT event_number, event_type, title, status, actor_id, operation_record_id
      FROM qna_thread_events WHERE thread_id = 'lifecycle-thread';
    `);
    assert(
      thread?.version === 1 && thread?.deleted_at === null && thread?.status === "ANSWERED",
      "0010 upgrade가 기존 Q&A head를 active version 1로 backfill하지 못했습니다.",
    );
    assert(
      threadBaseline?.event_number === 1 &&
        threadBaseline?.event_type === "BASELINE" &&
        threadBaseline?.title === "Lifecycle Q&A" &&
        threadBaseline?.status === "ANSWERED" &&
        threadBaseline?.actor_id === null &&
        threadBaseline?.operation_record_id === null,
      "0010 upgrade가 기존 Q&A BASELINE event를 만들지 못했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT id FROM qna_replies WHERE thread_id = 'lifecycle-thread';").length === 2,
      "0010 upgrade가 기존 Q&A reply를 보존하지 못했습니다.",
    );
    assertSqlFails(
      upgradeDatabase,
      "DELETE FROM profiles WHERE id = 'lifecycle-student';",
      "post comment/Q&A history 보유 profile RESTRICT",
      "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0010 upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }
}

function validateContinuitySemantics(database) {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES ('probe-user', 'probe-user@example.com', 'Probe User', 'student');
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'probe-receipt', 'probe-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'CREATE', 'probe-note', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES (
      'probe-note', 'probe-user', 'probe-user', 'Probe', '<p>Probe</p>',
      1700000000, 1700000000, 1
    );
    INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'probe-revision', 'probe-note', 1, 'CREATE', 'Probe', '<p>Probe</p>',
      '${hashB}', 1, 'probe-user', 'probe-receipt', 1700000000
    );
    INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id,
      source_version, purged_at, purged_by_id
    ) VALUES (
      'PRIVATE_NOTE', 'standalone-tombstone', 'probe-user', 'probe-user',
      1, 1700000000, 'probe-user'
    );
  `);

  assertSqlFails(
    database,
    "INSERT INTO document_batch_abort_guard (reason) VALUES ('probe');",
    "batch abort sentinel",
    "DOCUMENT_BATCH_ABORT",
  );
  assert(
    database.all("SELECT * FROM document_batch_abort_guard;").length === 0,
    "batch abort guard에 row가 남았습니다.",
  );
  assertSqlFails(
    database,
    "UPDATE private_notes SET version = 0 WHERE id = 'probe-note';",
    "private note version CHECK",
  );
  assertSqlFails(
    database,
    "UPDATE document_operation_ledger SET result_revision = 2 WHERE id = 'probe-receipt';",
    "ledger immutable update",
    "DOCUMENT_LEDGER_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM document_operation_ledger WHERE id = 'probe-receipt';",
    "ledger immutable delete",
    "DOCUMENT_LEDGER_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "UPDATE document_tombstones SET source_version = 2 WHERE resource_id = 'standalone-tombstone';",
    "tombstone immutable update",
    "DOCUMENT_TOMBSTONE_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM document_tombstones WHERE resource_id = 'standalone-tombstone';",
    "tombstone immutable delete",
    "DOCUMENT_TOMBSTONE_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "UPDATE private_note_revisions SET title = 'Changed' WHERE id = 'probe-revision';",
    "revision immutable update",
    "PRIVATE_NOTE_REVISION_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM private_note_revisions WHERE id = 'probe-revision';",
    "active revision delete guard",
    "PRIVATE_NOTE_REVISION_DELETE_GUARD",
  );
  assertSqlFails(
    database,
    `INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html, created_at
    ) VALUES ('late-baseline', 'probe-note', 1, 'BASELINE', 'Probe', '<p>Probe</p>', 1700000001);`,
    "rollout 뒤 BASELINE insert",
    "PRIVATE_NOTE_BASELINE_CLOSED",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES ('bad-ledger-type', 'bad-operation', 'probe-user', 'probe-user',
      'OTHER', 'CREATE', 'bad-note', '${hashA}', 1, 1, 1700000000);`,
    "ledger resource type CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES ('bad-ledger-version', 'bad-version-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'UPDATE', 'bad-note', '${hashA}', 1, 0, 1700000000);`,
    "ledger result revision CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id, source_version, purged_at
    ) VALUES ('PRIVATE_NOTE', 'bad-tombstone', 'probe-user', 'probe-user', 0, 1700000000);`,
    "tombstone source version CHECK",
  );

  for (const recursiveTriggers of ["OFF", "ON"]) {
    database.exec(`PRAGMA recursive_triggers = ${recursiveTriggers};`);
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO document_operation_ledger (
        id, operation_id, actor_id, subject_id, resource_type, operation_type,
        resource_id, request_hash, request_hash_version, result_revision, created_at
      ) VALUES ('probe-receipt', 'probe-operation', 'probe-user', 'probe-user',
        'PRIVATE_NOTE', 'CREATE', 'probe-note', '${hashA}', 1, 1, 1700000000);`,
      `ledger INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "DOCUMENT_LEDGER_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO document_tombstones (
        resource_type, resource_id, subject_id, owner_id, source_version, purged_at
      ) VALUES ('PRIVATE_NOTE', 'standalone-tombstone', 'probe-user', 'probe-user', 1, 1700000000);`,
      `tombstone INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "DOCUMENT_TOMBSTONE_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO private_note_revisions (
        id, note_id, revision_number, change_type, title, content_html,
        snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
      ) VALUES ('probe-revision', 'probe-note', 1, 'CREATE', 'Probe', '<p>Probe</p>',
        '${hashB}', 1, 'probe-user', 'probe-receipt', 1700000000);`,
      `revision INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "PRIVATE_NOTE_REVISION_DUPLICATE",
    );
  }
  database.exec("PRAGMA recursive_triggers = OFF;");

  database.exec(`
    INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id, source_version, purged_at
    ) VALUES ('PRIVATE_NOTE', 'probe-note', 'probe-user', 'probe-user', 1, 1700000000);
  `);
  assertSqlFails(
    database,
    "DELETE FROM private_note_revisions WHERE id = 'probe-revision';",
    "live head와 tombstone 공존 시 revision delete guard",
    "PRIVATE_NOTE_REVISION_DELETE_GUARD",
  );

  database.exec(`
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'hard-delete-receipt', 'hard-delete-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'CREATE', 'hard-delete-note', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES (
      'hard-delete-note', 'probe-user', 'probe-user', 'Hard delete', '<p>Hard delete</p>',
      1700000000, 1700000000, 1
    );
    INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'hard-delete-revision', 'hard-delete-note', 1, 'CREATE', 'Hard delete', '<p>Hard delete</p>',
      '${hashB}', 1, 'probe-user', 'hard-delete-receipt', 1700000000
    );
    DELETE FROM private_notes WHERE id = 'hard-delete-note';
  `);
  assert(
    database.all(
      "SELECT * FROM document_tombstones WHERE resource_id = 'hard-delete-note';",
    ).length === 1,
    "private note 직접 hard delete가 tombstone을 만들지 않았습니다.",
  );
  assert(
    database.all(
      "SELECT * FROM private_note_revisions WHERE note_id = 'hard-delete-note';",
    ).length === 0,
    "private note hard delete 뒤 revision cascade가 완료되지 않았습니다.",
  );
  assertSqlFails(
    database,
    `INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES ('hard-delete-note', 'probe-user', 'probe-user', 'Resurrect', '<p>Resurrect</p>',
      1700000001, 1700000001, 1);`,
    "tombstone resource resurrection",
    "PRIVATE_NOTE_RESURRECTION_BLOCKED",
  );

  database.exec(`
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'mismatch-receipt', 'mismatch-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'UPDATE', 'another-note', '${hashA}', 1, 2, 1700000001
    );
  `);
  assertSqlFails(
    database,
    `INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES ('mismatch-revision', 'probe-note', 2, 'UPDATE', 'Mismatch', '<p>Mismatch</p>',
      '${hashB}', 1, 'probe-user', 'mismatch-receipt', 1700000001);`,
    "revision receipt resource mismatch",
    "PRIVATE_NOTE_REVISION_RECEIPT_MISMATCH",
  );

  const headRevisionMismatches = database.all(`
    SELECT note.id
    FROM private_notes AS note
    LEFT JOIN private_note_revisions AS revision ON revision.note_id = note.id
    GROUP BY note.id, note.version
    HAVING max(revision.revision_number) <> note.version
  `);
  assert(
    headRevisionMismatches.length === 0,
    `semantic probe 뒤 head/revision 불변식이 깨졌습니다: ${JSON.stringify(headRevisionMismatches)}`,
  );
  assert(
    database.all("PRAGMA foreign_key_check;").length === 0,
    "semantic probe 뒤 foreign key 위반이 있습니다.",
  );
}

function validateLifecycleExpansionSemantics(database) {
  const hashA = "c".repeat(64);
  const hashB = "d".repeat(64);
  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES
      ('lifecycle-probe-student', 'lifecycle-probe-student@example.com', 'Probe Student', 'student'),
      ('lifecycle-probe-admin', 'lifecycle-probe-admin@example.com', 'Probe Admin', 'admin');
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'post-probe-receipt', 'post-probe-operation',
      'lifecycle-probe-admin', 'lifecycle-probe-admin',
      'COMMUNITY_POST', 'CREATE', 'post-probe', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, title, content_html,
      created_at, updated_at, version
    ) VALUES (
      'post-probe', 'lifecycle-probe-admin', 'general', 'GENERAL', 0,
      'Post probe', '<p>Post probe</p>', 1700000000, 1700000000, 1
    );
    INSERT INTO post_revisions (
      id, post_id, revision_number, change_type, category, board_type,
      is_pinned, title, content_html, snapshot_hash, snapshot_hash_version,
      actor_id, operation_record_id, created_at
    ) VALUES (
      'post-probe-revision', 'post-probe', 1, 'CREATE', 'general', 'GENERAL',
      0, 'Post probe', '<p>Post probe</p>', '${hashB}', 1,
      'lifecycle-probe-admin', 'post-probe-receipt', 1700000000
    );
    INSERT INTO comments (id, post_id, author_id, content_html, created_at)
    VALUES (
      'post-probe-comment', 'post-probe', 'lifecycle-probe-student',
      '<p>Comment</p>', 1700000001
    );

    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'qna-probe-receipt', 'qna-probe-operation',
      'lifecycle-probe-student', 'lifecycle-probe-student',
      'QNA_THREAD', 'CREATE', 'qna-probe', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'qna-probe', 'lifecycle-probe-student', 'Q&A probe', 'OPEN',
      1700000000, 1700000000, 1
    );
    INSERT INTO qna_replies (
      id, thread_id, author_id, content_html, created_at
    ) VALUES (
      'qna-probe-reply', 'qna-probe', 'lifecycle-probe-student',
      '<p>Question</p>', 1700000000
    );
    INSERT INTO qna_thread_events (
      id, thread_id, event_number, event_type, title, status, reply_id,
      event_hash, event_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'qna-probe-event', 'qna-probe', 1, 'CREATE', 'Q&A probe', 'OPEN',
      'qna-probe-reply', '${hashB}', 1, 'lifecycle-probe-student',
      'qna-probe-receipt', 1700000000
    );
  `);

  assertSqlFails(
    database,
    `INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'bad-resource-operation', 'bad-resource-operation',
      'lifecycle-probe-student', 'lifecycle-probe-student',
      'PRIVATE_NOTE', 'APPEND_REPLY', 'bad-note', '${hashA}', 1, 1, 1700000000
    );`,
    "ledger resource/operation compatibility CHECK",
  );
  assertSqlFails(
    database,
    "UPDATE post_revisions SET title = 'Changed' WHERE id = 'post-probe-revision';",
    "post revision immutable update",
    "POST_REVISION_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO post_revisions (
      id, post_id, revision_number, change_type, category, board_type,
      is_pinned, title, content_html, created_at
    ) VALUES (
      'post-late-baseline', 'post-probe', 1, 'BASELINE', 'general', 'GENERAL',
      0, 'Late', '<p>Late</p>', 1700000001
    );`,
    "post rollout 뒤 BASELINE insert",
    "POST_BASELINE_CLOSED",
  );
  assertSqlFails(
    database,
    `INSERT INTO comments (id, post_id, author_id, content_html)
     VALUES ('missing-post-comment', 'missing-post', 'lifecycle-probe-student', '<p>Missing</p>');`,
    "missing/trashed post comment insert",
    "COMMENT_ACTIVE_POST_REQUIRED",
  );
  assertSqlFails(
    database,
    "UPDATE qna_replies SET content_html = '<p>Changed</p>' WHERE id = 'qna-probe-reply';",
    "Q&A reply immutable update",
    "QNA_REPLY_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO qna_replies (id, thread_id, author_id, content_html)
     VALUES ('qna-unreceipted-reply', 'qna-probe', 'lifecycle-probe-student', '<p>Extra</p>');`,
    "Q&A unreceipted reply insert",
    "QNA_REPLY_RECEIPT_MISMATCH",
  );
  assertSqlFails(
    database,
    "UPDATE qna_thread_events SET title = 'Changed' WHERE id = 'qna-probe-event';",
    "Q&A event immutable update",
    "QNA_THREAD_EVENT_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'qna-invalid-status', 'lifecycle-probe-student', 'Invalid', 'OTHER',
      1700000000, 1700000000, 1
    );`,
    "Q&A status insert guard",
    "QNA_THREAD_STATE_INVALID",
  );

  database.exec(`
    UPDATE posts
    SET deleted_at = 1700000002, deleted_by_id = 'lifecycle-probe-admin'
    WHERE id = 'post-probe';
    UPDATE qna_threads
    SET deleted_at = 1700000002, deleted_by_id = 'lifecycle-probe-student'
    WHERE id = 'qna-probe';
  `);
  assertSqlFails(
    database,
    "DELETE FROM comments WHERE id = 'post-probe-comment';",
    "trashed post comment delete guard",
    "COMMENT_TRASHED_POST_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM qna_replies WHERE id = 'qna-probe-reply';",
    "active Q&A reply delete guard",
    "QNA_REPLY_DELETE_GUARD",
  );

  database.exec(`
    DELETE FROM posts WHERE id = 'post-probe';
    DELETE FROM qna_threads WHERE id = 'qna-probe';
  `);
  assert(
    database.all(`
      SELECT resource_id FROM document_tombstones
      WHERE (resource_type = 'COMMUNITY_POST' AND resource_id = 'post-probe')
         OR (resource_type = 'QNA_THREAD' AND resource_id = 'qna-probe');
    `).length === 2,
    "post/Q&A hard delete가 tombstone을 남기지 않았습니다.",
  );
  assert(
    database.all("SELECT id FROM comments WHERE post_id = 'post-probe';").length === 0 &&
      database.all("SELECT id FROM qna_replies WHERE thread_id = 'qna-probe';").length === 0 &&
      database.all("SELECT id FROM qna_thread_events WHERE thread_id = 'qna-probe';").length === 0,
    "post/Q&A purge cascade가 child history를 정리하지 못했습니다.",
  );
  assertSqlFails(
    database,
    `INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, title, content_html,
      created_at, updated_at, version
    ) VALUES (
      'post-probe', 'lifecycle-probe-admin', 'general', 'GENERAL', 0,
      'Resurrect', '<p>Resurrect</p>', 1700000003, 1700000003, 1
    );`,
    "post tombstone resurrection",
    "POST_RESURRECTION_BLOCKED",
  );
  assertSqlFails(
    database,
    `INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'qna-probe', 'lifecycle-probe-student', 'Resurrect', 'OPEN',
      1700000003, 1700000003, 1
    );`,
    "Q&A tombstone resurrection",
    "QNA_THREAD_RESURRECTION_BLOCKED",
  );
  assert(
    database.all("PRAGMA foreign_key_check;").length === 0,
    "post/Q&A lifecycle semantic probe 뒤 foreign key 위반이 있습니다.",
  );
}

function validateServerDraftSemantics(database) {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const sourceKey = "draft:document:note:server-probe-user:new";
  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES ('server-probe-user', 'server-probe@example.com', 'Server Probe', 'student');
    INSERT INTO document_server_drafts (
      owner_id, source_key, document_kind, context_id, payload_json,
      payload_hash, draft_version, base_resource_version, writer_device_id,
      created_at, updated_at, expires_at
    ) VALUES (
      'server-probe-user', '${sourceKey}', 'note', 'new',
      '{"contentHtml":"<p>probe</p>","title":"probe"}', '${hashA}', 1, NULL,
      '00000000-0000-4000-8000-000000000001',
      1700000000, 1700000000, 1702592000
    );
    INSERT INTO document_server_draft_operations (
      owner_id, operation_id, source_key, operation_type, request_hash,
      request_hash_version, result_version, result_state, created_at, expires_at
    ) VALUES (
      'server-probe-user', '00000000-0000-4000-8000-000000000002',
      '${sourceKey}', 'UPSERT', '${hashB}', 1, 1, 'PRESENT',
      1700000000, 1702592000
    );
  `);

  assertSqlFails(
    database,
    `UPDATE document_server_drafts SET draft_version = 3 WHERE owner_id = 'server-probe-user' AND source_key = '${sourceKey}';`,
    "server draft skipped CAS version",
    "DOCUMENT_SERVER_DRAFT_CAS_GUARD",
  );
  assertSqlFails(
    database,
    `UPDATE document_server_drafts SET context_id = 'other', draft_version = 2, updated_at = 1700000001, expires_at = 1702592001 WHERE owner_id = 'server-probe-user' AND source_key = '${sourceKey}';`,
    "server draft identity mutation",
    "DOCUMENT_SERVER_DRAFT_CAS_GUARD",
  );
  assertSqlFails(
    database,
    `UPDATE document_server_draft_operations SET result_version = 2 WHERE owner_id = 'server-probe-user';`,
    "server draft operation immutable update",
    "DOCUMENT_SERVER_DRAFT_OPERATION_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_server_drafts (
      owner_id, source_key, document_kind, context_id, payload_json,
      payload_hash, draft_version, writer_device_id, created_at, updated_at, expires_at
    ) VALUES ('server-probe-user', 'invalid-kind', 'other', 'new', '{}', '${hashA}', 1,
      'device', 1700000000, 1700000000, 1702592000);`,
    "server draft kind CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_server_drafts (
      owner_id, source_key, document_kind, context_id, payload_json,
      payload_hash, draft_version, writer_device_id, created_at, updated_at, expires_at
    ) VALUES ('server-probe-user', 'invalid-json', 'note', 'new', '{', '${hashA}', 1,
      'device', 1700000000, 1700000000, 1702592000);`,
    "server draft JSON CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_server_drafts (
      owner_id, source_key, document_kind, context_id, payload_json,
      payload_hash, draft_version, base_resource_version, writer_device_id,
      created_at, updated_at, expires_at
    ) VALUES ('server-probe-user', 'invalid-version', 'note', 'new', '{}', '${hashA}', 0, 0,
      'device', 1700000000, 1700000000, 1702592000);`,
    "server draft version CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_server_draft_operations (
      owner_id, operation_id, source_key, operation_type, request_hash,
      request_hash_version, result_version, result_state, created_at, expires_at
    ) VALUES ('server-probe-user', 'bad-state', '${sourceKey}', 'DISCARD',
      '${hashA}', 1, 1, 'PRESENT', 1700000000, 1702592000);`,
    "server draft operation state CHECK",
  );

  for (const recursiveTriggers of ["OFF", "ON"]) {
    database.exec(`PRAGMA recursive_triggers = ${recursiveTriggers};`);
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO document_server_drafts (
        owner_id, source_key, document_kind, context_id, payload_json,
        payload_hash, draft_version, writer_device_id, created_at, updated_at, expires_at
      ) VALUES ('server-probe-user', '${sourceKey}', 'note', 'new', '{}', '${hashA}', 1,
        'device', 1700000000, 1700000000, 1702592000);`,
      `server draft INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "DOCUMENT_SERVER_DRAFT_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO document_server_draft_operations (
        owner_id, operation_id, source_key, operation_type, request_hash,
        request_hash_version, result_version, result_state, created_at, expires_at
      ) VALUES ('server-probe-user', '00000000-0000-4000-8000-000000000002',
        '${sourceKey}', 'UPSERT', '${hashB}', 1, 1, 'PRESENT', 1700000000, 1702592000);`,
      `server draft operation INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "DOCUMENT_SERVER_DRAFT_OPERATION_DUPLICATE",
    );
  }
  database.exec("PRAGMA recursive_triggers = OFF;");

  database.exec(`
    UPDATE document_server_drafts
    SET payload_json = '{"title":"next"}', payload_hash = '${hashB}',
        draft_version = 2, writer_device_id = '00000000-0000-4000-8000-000000000003',
        updated_at = 1700000001, expires_at = 1702592001
    WHERE owner_id = 'server-probe-user' AND source_key = '${sourceKey}';
  `);
  const [updated] = database.all(`
    SELECT draft_version, payload_hash
    FROM document_server_drafts
    WHERE owner_id = 'server-probe-user' AND source_key = '${sourceKey}';
  `);
  assert(
    updated?.draft_version === 2 && updated?.payload_hash === hashB,
    "server draft 정상 CAS update가 반영되지 않았습니다.",
  );
  assert(
    database.all("PRAGMA foreign_key_check;").length === 0,
    "server draft semantic probe 뒤 foreign key 위반이 있습니다.",
  );
}

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
    console.log("PASS document continuity and server draft CHECK/trigger signatures");

    validateContinuitySemantics(migrationDatabase);
    validateLifecycleExpansionSemantics(migrationDatabase);
    validateServerDraftSemantics(migrationDatabase);
    console.log("PASS document lifecycle and server draft semantic negative probes");

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
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL migration consistency check\n${message}`);
  process.exitCode = 1;
}
