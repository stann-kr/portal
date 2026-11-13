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

test("같은 이름이 반복된 query(배열)처럼 문자열이 아닌 값은 fallback이다", () => {
  for (const value of [["/a", "/b"], 42, undefined, {}]) {
    assert.equal(safeReturnPath(value, "/dashboard"), "/dashboard");
  }
});

test("정규화하면 protocol-relative가 되는 점 세그먼트 경로를 거부한다", () => {
  for (const value of ["/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/x/..//evil.example?next=1"]) {
    assert.equal(safeReturnPath(value, "/dashboard"), "/dashboard", value);
  }
  assert.equal(safeReturnPath("/./community?board=mix", "/dashboard"), "/community?board=mix");
});
