import { journalPath, metadataDirectory, readJson } from "./runtime.mjs";
import { readdirSync } from "node:fs";
import { assert, assertRowsEqual } from "./assertions.mjs";
import { join } from "node:path";

const snapshotPattern = /^\d{4}_snapshot\.json$/;

const zeroSnapshotId = "00000000-0000-0000-0000-000000000000";

const continuityTables = [
  "account_cleanup_tokens",
  "account_deletion_jobs",
  "calendar_feed_tokens",
  "document_operation_ledger",
  "document_server_draft_operations",
  "document_server_drafts",
  "document_tombstones",
  "external_calendar_subscriptions",
  "media_deletion_outbox",
  "media_objects",
  "private_notes",
  "private_note_revisions",
  "post_revisions",
  "posts",
  "qna_thread_events",
  "qna_threads",
];

const continuityCheckNames = {
  account_cleanup_tokens: [
    "account_cleanup_tokens_digest_check",
    "account_cleanup_tokens_state_check",
  ],
  account_deletion_jobs: [
    "account_deletion_jobs_hash_check",
    "account_deletion_jobs_identity_check",
    "account_deletion_jobs_initiator_check",
    "account_deletion_jobs_state_check",
    "account_deletion_jobs_timestamp_check",
  ],
  calendar_feed_tokens: [
    "calendar_feed_tokens_digest_check",
    "calendar_feed_tokens_timestamp_check",
  ],
  external_calendar_subscriptions: [
    "external_calendar_subscriptions_payload_check",
    "external_calendar_subscriptions_provider_check",
    "external_calendar_subscriptions_timestamp_check",
  ],
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
  media_deletion_outbox: [
    "media_deletion_outbox_attempt_check",
    "media_deletion_outbox_identity_check",
    "media_deletion_outbox_lease_check",
    "media_deletion_outbox_reason_check",
    "media_deletion_outbox_timestamp_check",
  ],
  media_objects: [
    "media_objects_identity_check",
    "media_objects_key_check",
    "media_objects_purpose_check",
    "media_objects_resource_pair_check",
    "media_objects_resource_type_check",
    "media_objects_size_check",
    "media_objects_state_check",
    "media_objects_state_payload_check",
    "media_objects_timestamp_check",
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

export const databaseSignatures = {
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

export function normalizeDatabaseColumns(columns) {
  return columns.map((column) => ({
    ...column,
    default_value: normalizeDefaultValue(column.default_value),
  }));
}

export function normalizeSqlSignature(value, tableName = "") {
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

export function validateMetadata(migrationFiles) {
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

export function normalizeSnapshot(snapshot) {
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

export function validateContinuityChecks(database, latestSnapshot, label) {
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
