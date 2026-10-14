import assert from "node:assert/strict";
import test from "node:test";
import {
  getOrCreateOpenConnection,
  selectLocalD1SqliteFile,
  type CachedOpenConnection,
} from "./local-connection-cache";

type FakeConnection = {
  id: string;
  open: boolean;
  close: () => void;
};

function fakeConnection(id: string, open = true): FakeConnection {
  return {
    id,
    open,
    close() {
      this.open = false;
    },
  };
}

test("같은 경로의 열린 연결을 재사용한다", () => {
  const cached = fakeConnection("cached");
  const cache = new Map<string, CachedOpenConnection<FakeConnection>>([
    ["portal.sqlite", { connection: cached, fileIdentity: "device:inode-1" }],
  ]);
  let createCount = 0;

  const connection = getOrCreateOpenConnection(
    cache,
    "portal.sqlite",
    "device:inode-1",
    () => {
      createCount += 1;
      return fakeConnection("created");
    },
  );

  assert.equal(connection, cached);
  assert.equal(createCount, 0);
});

test("닫힌 연결은 새 연결로 교체한다", () => {
  const cache = new Map<string, CachedOpenConnection<FakeConnection>>([
    [
      "portal.sqlite",
      { connection: fakeConnection("closed", false), fileIdentity: "device:inode-1" },
    ],
  ]);

  const connection = getOrCreateOpenConnection(
    cache,
    "portal.sqlite",
    "device:inode-1",
    () => fakeConnection("replacement"),
  );

  assert.equal(connection.id, "replacement");
  assert.equal(cache.get("portal.sqlite")?.connection, connection);
});

test("서로 다른 경로의 연결은 분리한다", () => {
  const first = fakeConnection("first");
  const cache = new Map<string, CachedOpenConnection<FakeConnection>>([
    ["first.sqlite", { connection: first, fileIdentity: "device:inode-1" }],
  ]);

  const second = getOrCreateOpenConnection(
    cache,
    "second.sqlite",
    "device:inode-2",
    () => fakeConnection("second"),
  );

  assert.equal(cache.get("first.sqlite")?.connection, first);
  assert.equal(cache.get("second.sqlite")?.connection, second);
});

test("같은 경로의 SQLite 파일이 교체되면 이전 연결을 닫고 새 연결을 만든다", () => {
  const previous = fakeConnection("previous");
  const cache = new Map<string, CachedOpenConnection<FakeConnection>>([
    ["portal.sqlite", { connection: previous, fileIdentity: "device:inode-old" }],
  ]);

  const replacement = getOrCreateOpenConnection(
    cache,
    "portal.sqlite",
    "device:inode-new",
    () => fakeConnection("replacement"),
  );

  assert.equal(previous.open, false);
  assert.equal(replacement.id, "replacement");
  assert.equal(cache.get("portal.sqlite")?.connection, replacement);
});

test("Wrangler metadata DB를 제외하고 앱 D1 파일만 선택한다", () => {
  assert.equal(
    selectLocalD1SqliteFile([
      "metadata.sqlite",
      "portal-hash.sqlite",
      "portal-hash.sqlite-wal",
    ]),
    "portal-hash.sqlite",
  );
});

test("앱 D1 후보가 여러 개면 임의 선택하지 않는다", () => {
  assert.throws(
    () => selectLocalD1SqliteFile(["a.sqlite", "metadata.sqlite", "b.sqlite"]),
    /정확히 1개/u,
  );
});
