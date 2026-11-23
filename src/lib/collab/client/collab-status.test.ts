import assert from "node:assert/strict";
import test from "node:test";
import { describeCollabPending, describeCollabStatus, isCollabEditorPending } from "./collab-status";

const base = { connection: "connecting" as const, seedState: "idle" as const, seedMessage: null, slow: false };

test("편집기 준비 전: 처음은 준비 중, 늦어지면 늦어짐 안내로 바꾼다", () => {
  assert.deepEqual(describeCollabPending(base), { kind: "connecting", title: "편집기를 준비하는 중…", detail: null, canRetry: false });
  assert.equal(describeCollabPending({ ...base, label: "노트를 불러오는 중…" }).title, "노트를 불러오는 중…");
  const slow = describeCollabPending({ ...base, slow: true });
  assert.equal(slow.kind, "slow");
  assert.equal(slow.title, "서버 연결이 늦어지고 있습니다");
});

test("편집기 준비 전: 실패는 이유를 보이고 다시 할 수 있을 때만 다시 시도를 둔다", () => {
  const failed = describeCollabPending({ ...base, seedState: "failed", seedMessage: "최신 내용을 불러오지 못했습니다.", slow: true });
  assert.equal(failed.kind, "failed");
  assert.equal(failed.canRetry, true);
  assert.equal(failed.title, "최신 내용을 불러오지 못했습니다");
  const stopped = describeCollabPending({ ...base, seedState: "stopped", seedMessage: "이 노트는 휴지통으로 이동했습니다." });
  assert.deepEqual(stopped, { kind: "failed", title: "이 노트는 휴지통으로 이동했습니다.", detail: null, canRetry: false });
  const denied = describeCollabPending({ ...base, connection: "denied", deniedMessage: "이 게시물을 수정할 수 없습니다." });
  assert.equal(denied.title, "이 게시물을 수정할 수 없습니다.");
  assert.equal(denied.canRetry, false);
  assert.equal(describeCollabPending({ ...base, connection: "denied" }).title, "이 문서를 열 수 없습니다");
  assert.equal(describeCollabPending({ ...base, connection: "too-large" }).kind, "failed");
});

test("기기 보관본으로 내용이 있어도 서버가 권한을 알려 주기 전(연결 중)에는 대기 안내를 보이고, 첫 오프라인은 편집기를 둔다", () => {
  assert.equal(isCollabEditorPending({ ready: false, mode: null, status: "connecting" }), true);
  assert.equal(isCollabEditorPending({ ready: true, mode: null, status: "connecting" }), true);
  assert.equal(isCollabEditorPending({ ready: true, mode: null, status: "offline" }), false);
  assert.equal(isCollabEditorPending({ ready: true, mode: "write", status: "connecting" }), false);
  assert.equal(isCollabEditorPending({ ready: true, mode: "read", status: "connected" }), false);
});

const statusBase = { mode: "write" as const, isSaver: true, autosaveError: null, blockedMessage: "b" };

test("실시간 연결 중 확인이 늦으면 동기화 중, 버전 저장 대기는 보관됨, 저장 뒤에는 버전 시각을 보인다", () => {
  assert.equal(describeCollabStatus({ ...statusBase, connection: "connected", autosave: "saved", syncing: true }).shortMessage, "동기화 중");
  const pending = describeCollabStatus({ ...statusBase, connection: "connected", autosave: "pending" });
  assert.equal(pending.kind, "saved");
  assert.equal(pending.shortMessage, "보관됨");
  assert.equal(describeCollabStatus({ ...statusBase, connection: "offline", autosave: "pending" }).shortMessage, "오프라인");
  assert.equal(describeCollabStatus({ ...statusBase, connection: "solo", autosave: "pending" }).message, "곧 저장됩니다");
  const at = new Date(2026, 10, 23, 9, 5);
  assert.equal(describeCollabStatus({ ...statusBase, connection: "connected", autosave: "saved", savedAt: at }).message, "버전 저장 09:05 · 실시간 연결됨");
  assert.equal(describeCollabStatus({ ...statusBase, connection: "solo", autosave: "saved", savedAt: at }).message, "저장됨 · 09:05");
});
