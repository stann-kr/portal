import assert from "node:assert/strict";
import test from "node:test";
import {
  createCreationOperationId,
  deriveCreationResourceId,
  parseCreationOperationId,
  resolveCreationOperationId,
} from "./creation-operation";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test("브라우저 생성 작업 ID는 UUID v4 계약을 따른다", () => {
  const operationId = createCreationOperationId();

  assert.match(operationId, UUID_V4);
  assert.equal(parseCreationOperationId(operationId.toUpperCase()), operationId);
});

test("전달된 비정상 생성 작업 ID는 서버 fallback으로 바꾸지 않는다", () => {
  assert.equal(resolveCreationOperationId(""), null);
  assert.equal(resolveCreationOperationId("not-an-operation-id"), null);
  assert.equal(
    parseCreationOperationId("7f464e7c-d497-5c24-a2d5-b8710eec3a48"),
    null,
  );
  assert.equal(resolveCreationOperationId(null), null);
});

test("같은 생성 작업의 내부 리소스 ID는 결정적인 UUID v8이다", () => {
  const operationId = "c00e5ee7-36ae-45eb-a39a-d96f6292a842";
  const first = deriveCreationResourceId(operationId, "qna-initial-reply");
  const retry = deriveCreationResourceId(operationId, "qna-initial-reply");
  const other = deriveCreationResourceId(operationId, "other-purpose");

  assert.match(first, UUID_V8);
  assert.equal(retry, first);
  assert.notEqual(other, first);
});
