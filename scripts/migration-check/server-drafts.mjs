import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyMigration,
  applyMigrations,
  createMemoryDatabase,
  migrationsDirectory,
  serverDraftMigrationFile,
} from "./runtime.mjs";
import { normalizeSqlSignature } from "./schema.mjs";

const serverDraftTriggerNames = [
  "document_server_draft_operations_before_insert_existing",
  "document_server_draft_operations_immutable_update",
  "document_server_drafts_before_insert_existing",
  "document_server_drafts_cas_update_guard",
];

export function validateServerDraftTriggers(database) {
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

export async function validateServerDraftUpgrade(migrationFiles) {
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

export function validateServerDraftSemantics(database) {
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
