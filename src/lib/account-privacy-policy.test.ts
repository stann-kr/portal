import assert from "node:assert/strict";
import test from "node:test";
import { accountDeletionLoginMessage } from "./account-privacy-policy";

test("로그인 완료 안내는 삭제 marker가 있을 때만 표시된다", () => {
  assert.equal(accountDeletionLoginMessage(undefined, undefined), null);
  assert.equal(accountDeletionLoginMessage("0", "pending"), null);
  assert.equal(
    accountDeletionLoginMessage("1", undefined),
    "포털 계정 데이터와 이 기기에 확인된 계정 데이터를 삭제했습니다.",
  );
});

test("기기 정리 미완료는 서버 삭제와 local retry를 구분한다", () => {
  assert.equal(
    accountDeletionLoginMessage("1", "pending"),
    "포털 계정 데이터는 삭제했습니다. 이 기기 데이터 정리는 연결과 저장소 접근이 가능해지면 다시 시도합니다.",
  );
  assert.equal(
    accountDeletionLoginMessage("1", "manual"),
    "포털 계정 데이터는 삭제했습니다. 브라우저 저장소가 차단되어 이 기기 데이터는 자동 정리할 수 없습니다. 브라우저 설정에서 이 사이트의 저장 데이터를 직접 삭제해 주세요.",
  );
});
