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

function applyMigrations(database, migrationFiles) {
  database.exec("PRAGMA foreign_keys = ON;");

  for (const migrationFile of migrationFiles) {
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
    for (const column of Object.values(table.columns)) {
      columns.push({
        table_name: table.name,
        column_name: column.name,
        type: column.type.toLowerCase(),
        not_null: Number(column.notNull),
        default_value: normalizeDefaultValue(column.default),
        primary_key: Number(column.primaryKey),
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
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL migration consistency check\n${message}`);
  process.exitCode = 1;
}
