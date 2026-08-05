import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeServerSaveResponse,
  createServerSaveConfirmationState,
  dismissServerSaveConfirmation,
  isServerSaveConfirmationVisible,
} from "./server-save-confirmation";

test("새 서버 저장 응답만 성공 확인을 열고 입력 뒤 같은 응답으로 되살리지 않는다", () => {
  const firstResponse = { id: "note-1", version: 1 };
  let confirmation = createServerSaveConfirmationState<typeof firstResponse>();

  confirmation = acknowledgeServerSaveResponse(confirmation, firstResponse);
  assert.equal(isServerSaveConfirmationVisible(confirmation, firstResponse), true);

  confirmation = dismissServerSaveConfirmation(confirmation);
  assert.equal(isServerSaveConfirmationVisible(confirmation, firstResponse), false);

  confirmation = acknowledgeServerSaveResponse(confirmation, firstResponse);
  assert.equal(isServerSaveConfirmationVisible(confirmation, firstResponse), false);
});

test("다음 서버 저장 응답은 다시 확인을 열고 이전 응답에는 노출하지 않는다", () => {
  const firstResponse = { id: "note-1", version: 1 };
  const secondResponse = { ...firstResponse };
  let confirmation = acknowledgeServerSaveResponse(
    createServerSaveConfirmationState<typeof firstResponse>(),
    firstResponse,
  );

  assert.equal(isServerSaveConfirmationVisible(confirmation, secondResponse), false);
  confirmation = acknowledgeServerSaveResponse(confirmation, secondResponse);
  assert.equal(isServerSaveConfirmationVisible(confirmation, firstResponse), false);
  assert.equal(isServerSaveConfirmationVisible(confirmation, secondResponse), true);
});
