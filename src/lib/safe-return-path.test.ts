import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "./safe-return-path";

test("내부 경로의 query와 hash를 보존한다", () => {
  assert.equal(
    safeReturnPath("/dashboard/student?section=workspace&view=all#notes", "/dashboard"),
    "/dashboard/student?section=workspace&view=all#notes",
  );
});

test("외부·protocol-relative·backslash 경로를 거부한다", () => {
  for (const value of ["https://evil.example", "//evil.example/path", "/\\evil.example/path", null]) {
    assert.equal(safeReturnPath(value, "/dashboard"), "/dashboard");
  }
});
