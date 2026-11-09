import assert from "node:assert/strict";
import test from "node:test";
import { absolutePortalUrl, shareOrCopyLink } from "./CopyLinkButton";

function clipboard() {
  const written: string[] = [];
  return { written, writeText: async (text: string) => { written.push(text); } };
}

test("링크 복사: 터치 기기에서 공유 창이 있으면 공유하고 복사하지 않는다", async () => {
  const board = clipboard();
  const shared: string[] = [];
  const result = await shareOrCopyLink("https://portal.test/dashboard/qna/t", {
    navigator: { share: async ({ url }) => { shared.push(url); }, clipboard: board },
    preferShare: true,
  });
  assert.equal(result, "shared");
  assert.deepEqual(shared, ["https://portal.test/dashboard/qna/t"]);
  assert.deepEqual(board.written, []);
});

test("링크 복사: 넓은 화면(공유 비선호)이나 공유 창이 없으면 클립보드에 복사한다", async () => {
  const board = clipboard();
  let shareCalled = false;
  assert.equal(await shareOrCopyLink("https://p/x", {
    navigator: { share: async () => { shareCalled = true; }, clipboard: board },
    preferShare: false,
  }), "copied");
  assert.equal(shareCalled, false);
  assert.equal(await shareOrCopyLink("https://p/y", { navigator: { clipboard: board }, preferShare: true }), "copied");
  assert.deepEqual(board.written, ["https://p/x", "https://p/y"]);
});

test("링크 복사: 공유 창을 닫으면 아무것도 하지 않고, 공유가 다른 이유로 실패하면 복사한다", async () => {
  const board = clipboard();
  const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
  assert.equal(await shareOrCopyLink("https://p/a", {
    navigator: { share: async () => { throw abort; }, clipboard: board },
    preferShare: true,
  }), "cancelled");
  assert.equal(await shareOrCopyLink("https://p/b", {
    navigator: { share: async () => { throw new Error("NotAllowed"); }, clipboard: board },
    preferShare: true,
  }), "copied");
  assert.deepEqual(board.written, ["https://p/b"]);
  assert.equal(await shareOrCopyLink("https://p/c", { navigator: {}, preferShare: false }), "failed");
  assert.equal(await shareOrCopyLink("https://p/d", {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    preferShare: false,
  }), "failed");
});

test("링크 복사: 경로를 지금 origin의 절대 주소로 만든다", () => {
  assert.equal(
    absolutePortalUrl("https://portal.test", "/dashboard/student/assignments?task=t%201"),
    "https://portal.test/dashboard/student/assignments?task=t%201",
  );
});
