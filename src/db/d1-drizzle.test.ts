import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { d1DrizzleFor } from "./d1-drizzle";

function fakeBinding(): AnyD1Database {
  return {
    prepare() {
      throw new Error("not used");
    },
  } as unknown as AnyD1Database;
}

test("같은 D1 바인딩이면 Drizzle 인스턴스를 다시 쓰고, 다른 바인딩에는 옛 인스턴스를 주지 않는다", () => {
  const first = fakeBinding();
  const second = fakeBinding();

  const a = d1DrizzleFor(first);
  assert.equal(d1DrizzleFor(first), a);
  assert.equal(a.$client, first);

  const b = d1DrizzleFor(second);
  assert.notEqual(b, a);
  assert.equal(b.$client, second);
});
