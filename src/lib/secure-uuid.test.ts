import assert from "node:assert/strict";
import test from "node:test";
import { createSecureUuid } from "./secure-uuid";
import { parseCreationOperationId } from "./creation-operation";

test("native UUID is preserved when the browser provides it", () => {
  const expected = "a486065b-3832-4938-955b-bfcbaeb73c14";
  assert.equal(createSecureUuid({ randomUUID: () => expected }), expected);
});

test("a browser with getRandomValues only produces accepted v4 IDs with fresh entropy", () => {
  const browserCrypto = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const first = createSecureUuid(browserCrypto);
  const second = createSecureUuid(browserCrypto);
  assert.equal(parseCreationOperationId(first), first);
  assert.equal(parseCreationOperationId(second), second);
  assert.notEqual(first, second);
});

test("unavailable or failed secure randomness never falls back to a weak identifier", () => {
  assert.throws(() => createSecureUuid({}), /안전한 요청 식별자/);
  assert.throws(() => createSecureUuid({ getRandomValues() { throw new Error("random source unavailable"); } }), /random source unavailable/);
});
