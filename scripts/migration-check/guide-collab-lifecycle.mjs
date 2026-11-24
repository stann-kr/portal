import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const guideCollabLifecycleMigrationFile = "0040_guide_collab_lifecycle.sql";
const previousMigrationFile = "0039_remaining_flows.sql";

/**
 * 0039 → 0040: 가이드 공동 편집 lifecycle 표지(guide_pages.collab_lifecycle, 기본 0)를 더한다.
 * column 추가만이라 다른 table·index·trigger와 기존 row가 그대로이고(기존 페이지는 0), 새 column을 모르는 옛 코드의 INSERT·UPDATE도 된다.
 */
export async function validateGuideCollabLifecycleUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(guideCollabLifecycleMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0039 → 0040 guide collab lifecycle migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO guide_pages (id, title, sort_order, content_html, version, created_at, updated_at)
        VALUES ('gl-page', '가이드', 0, '<p>a</p>', 3, 1795000000, 1795000000),
               ('gl-trash', '휴지통', 1, '<p>b</p>', 1, 1795000000, 1795000000);
      UPDATE guide_pages SET deleted_at = 1795000100 WHERE id = 'gl-trash';
      INSERT INTO guide_page_revisions (id, page_id, page_version, title, content_html, reason, created_at)
        VALUES ('gl-rev', 'gl-page', 2, '가이드', '<p>old</p>', 'EDIT', 1795000050);
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, guideCollabLifecycleMigrationFile);

    assertRowsEqual(
      "0040 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !(entry.type === "table" && entry.name === "guide_pages")),
      existingSchema.filter((entry) => !(entry.type === "table" && entry.name === "guide_pages")),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (tableName !== "guide_pages") return row;
        assert(row.collab_lifecycle === 0, "0040 기존 guide_pages.collab_lifecycle은 0이어야 합니다(운영 room 세대 0과 같다).");
        const rest = { ...row };
        delete rest.collab_lifecycle;
        return rest;
      });
      assertRowsEqual(`0040 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    // 새 column을 모르는 옛 코드의 INSERT·저장 UPDATE가 그대로 된다(롤백 호환).
    database.exec(`
      INSERT INTO guide_pages (id, title, sort_order, created_at, updated_at) VALUES ('gl-old', '옛 가이드', 2, 1795000200, 1795000200);
      UPDATE guide_pages SET content_html = '<p>c</p>', version = version + 1 WHERE id = 'gl-page' AND version = 3;
    `);
    assertRowsEqual(
      "0040 옛 코드 쓰기 뒤 표지",
      database.all("SELECT id, version, collab_lifecycle FROM guide_pages ORDER BY id;"),
      [
        { id: "gl-old", version: 1, collab_lifecycle: 0 },
        { id: "gl-page", version: 4, collab_lifecycle: 0 },
        { id: "gl-trash", version: 1, collab_lifecycle: 0 },
      ],
    );
    let rejectedNull = false;
    try {
      database.exec("UPDATE guide_pages SET collab_lifecycle = NULL WHERE id = 'gl-page';");
    } catch {
      rejectedNull = true;
    }
    assert(rejectedNull, "0040 guide_pages.collab_lifecycle은 NULL일 수 없어야 합니다.");
    assertRowsEqual("0040 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
  } finally {
    database.close();
  }
}
