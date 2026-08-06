import assert from "node:assert/strict";
import test from "node:test";
import { createDeferredDocumentSerializer } from "./deferred-document-serializer";

test("연속 입력은 전체 문서 직렬화를 하지 않고 revision당 첫 read에서만 수행한다", () => {
  const document = createDeferredDocumentSerializer("<p>초기</p>");
  let serializeCount = 0;
  const serialize = () => {
    serializeCount += 1;
    return `<p>직렬화 ${serializeCount}</p>`;
  };

  for (let index = 0; index < 20; index += 1) document.markDirty();
  assert.equal(serializeCount, 0);
  assert.equal(document.read(serialize), "<p>직렬화 1</p>");
  assert.equal(document.read(serialize), "<p>직렬화 1</p>");
  assert.equal(serializeCount, 1);

  document.markDirty();
  assert.equal(document.read(serialize), "<p>직렬화 2</p>");
  assert.equal(serializeCount, 2);
});

test("서버 복원은 직렬화 없이 cache와 revision을 함께 교체한다", () => {
  const document = createDeferredDocumentSerializer("<p>초기</p>");
  let serializeCount = 0;
  document.markDirty();
  document.replace("<p>서버 복원</p>");

  assert.equal(
    document.read(() => {
      serializeCount += 1;
      return "<p>호출되면 안 됨</p>";
    }),
    "<p>서버 복원</p>",
  );
  assert.equal(serializeCount, 0);
});
