-- 노트 자동 저장 이력의 단계적 보관(최근 7일 10분 단위, 7~90일 하루 단위, 90일 뒤 삭제)을 허용한다.
-- 지울 수 있는 것은 문서가 남아 있는 노트의 UPDATE 이력 중 최신(head version)보다 앞선 것뿐이다.
-- CREATE·RESTORE_REVISION(복원 세대 표지)·TRASH·RESTORE_TRASH·BASELINE과 최신 이력은 그대로 지킨다.
-- 영구 삭제된 노트(tombstone)의 이력 정리 규칙은 기존과 같다.
DROP TRIGGER `private_note_revisions_guard_delete`;--> statement-breakpoint
CREATE TRIGGER `private_note_revisions_guard_delete`
BEFORE DELETE ON `private_note_revisions`
WHEN NOT (
	(
		NOT EXISTS (SELECT 1 FROM `private_notes` WHERE `id` = OLD.`note_id`)
		AND EXISTS (
			SELECT 1
			FROM `document_tombstones`
			WHERE `resource_type` = 'PRIVATE_NOTE'
				AND `resource_id` = OLD.`note_id`
		)
	)
	OR (
		OLD.`change_type` = 'UPDATE'
		AND EXISTS (
			SELECT 1
			FROM `private_notes` AS `note`
			WHERE `note`.`id` = OLD.`note_id`
				AND OLD.`revision_number` < `note`.`version`
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'PRIVATE_NOTE_REVISION_DELETE_GUARD');
END;
