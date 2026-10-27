import {
  applyMigration,
  applyMigrations,
  createMemoryDatabase,
  documentImageMigrationFile,
  externalCalendarMigrationFile,
} from "./runtime.mjs";
import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";

const EXISTING_MEDIA_ID = "60000000-0000-4000-8000-000000000001";
const IMAGE_MEDIA_ID = "60000000-0000-4000-8000-000000000002";

function mediaInsert({ id, purpose, objectKey, uploadObjectKey, contentType }) {
  return `
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '${id}', 'image-probe-owner', '${purpose}', '${objectKey}', '${uploadObjectKey}',
      'PENDING_UPLOAD', '${contentType}', 1024, 'image-probe-operation',
      1800003600, 1800000000, 1800000000
    );
  `;
}

/** 0013 데이터가 있는 DB에 0014를 적용해 기존 media·trigger 보존과 새 purpose를 확인한다. */
export async function validateDocumentImageUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(documentImageMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === externalCalendarMigrationFile,
    "0013 → 0014 document image migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES ('image-probe-owner', 'image-probe-owner@example.com', 'Image Owner', 'student');
      ${mediaInsert({
        id: EXISTING_MEDIA_ID,
        purpose: "QNA_ATTACHMENT",
        objectKey: "media/qna-attachment/61000000-0000-4000-8000-000000000001",
        uploadObjectKey: `media-upload/qna-attachment/${EXISTING_MEDIA_ID}`,
        contentType: "image/png",
      })}
    `);
    const readMedia = () => database.all("SELECT * FROM media_objects ORDER BY id;");
    const readTriggerNames = () => database
      .all("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name;")
      .map((row) => row.name);
    const existingMedia = readMedia();
    const existingTriggers = readTriggerNames();

    applyMigration(database, documentImageMigrationFile);

    assertRowsEqual("0014 upgrade 기존 media row 보존", readMedia(), existingMedia);
    assertRowsEqual(
      "0014 upgrade trigger 보존과 노트 media 삭제 guard 추가",
      readTriggerNames(),
      [...existingTriggers, "private_notes_before_delete_media_pending"].sort(),
    );

    database.exec(mediaInsert({
      id: IMAGE_MEDIA_ID,
      purpose: "DOCUMENT_IMAGE",
      objectKey: "media/document-image/61000000-0000-4000-8000-000000000002",
      uploadObjectKey: `media-upload/document-image/${IMAGE_MEDIA_ID}`,
      contentType: "image/webp",
    }));
    assertSqlFails(
      database,
      mediaInsert({
        id: "60000000-0000-4000-8000-000000000003",
        purpose: "DOCUMENT_IMAGE",
        objectKey: "media/qna-attachment/61000000-0000-4000-8000-000000000003",
        uploadObjectKey: "media-upload/document-image/60000000-0000-4000-8000-000000000003",
        contentType: "image/png",
      }),
      "0014 DOCUMENT_IMAGE key prefix",
      "media_objects_key_check",
    );
    assertSqlFails(
      database,
      mediaInsert({
        id: "60000000-0000-4000-8000-000000000004",
        purpose: "OTHER_IMAGE",
        objectKey: "media/document-image/61000000-0000-4000-8000-000000000004",
        uploadObjectKey: "media-upload/document-image/60000000-0000-4000-8000-000000000004",
        contentType: "image/png",
      }),
      "0014 purpose allowlist",
      "media_objects_purpose_check",
    );
    assertSqlFails(
      database,
      `UPDATE media_objects SET purpose = 'DOCUMENT_IMAGE' WHERE id = '${EXISTING_MEDIA_ID}';`,
      "0014 upgrade 뒤 media 상태 전이 trigger 재생성",
      "MEDIA_OBJECT_STATE_TRANSITION_INVALID",
    );
    assertRowsEqual("0014 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual(
      "0014 populated upgrade SQLite 무결성",
      database.all("PRAGMA integrity_check;"),
      [{ integrity_check: "ok" }],
    );
  } finally {
    database.close();
  }
}
