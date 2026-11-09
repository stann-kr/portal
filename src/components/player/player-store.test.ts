import assert from "node:assert/strict";
import test from "node:test";
import {
  bindPlayerOwner,
  claimLocalPlayback,
  getPlayerState,
  releaseLocalPlayback,
  resetPlayerForTests,
  resumeTrack,
  startTrack,
} from "./player-store";
import type { PlayerTrack } from "./player-state";

// 링크 곡은 공용 audio 요소(document)를 쓰지 않으므로 Node에서도 상태 전이를 확인할 수 있다.
const LINK_TRACK: PlayerTrack = {
  key: "post-1",
  kind: "youtube",
  url: "https://www.youtube.com/watch?v=abc",
  title: "믹스셋",
  subtitle: "김학생",
  href: "/community/post-1",
  mediaObjectId: null,
};

function fakeMedia() {
  const media = { paused: false, pauseCalls: 0, pause() { media.paused = true; media.pauseCalls += 1; } };
  return media;
}
const asElement = (media: ReturnType<typeof fakeMedia>) => media as unknown as HTMLMediaElement;

test("목록 줄 재생을 시작하면 하단 미니 플레이어를 멈추고, 다른 줄의 재생도 멈춘다", () => {
  resetPlayerForTests();
  startTrack(LINK_TRACK);
  assert.equal(getPlayerState().playing, true);

  const rowA = fakeMedia();
  claimLocalPlayback(asElement(rowA));
  assert.equal(getPlayerState().playing, false, "공용 곡이 멈춘다");
  assert.equal(getPlayerState().track?.key, "post-1", "곡은 남겨 다시 재생할 수 있다");

  const rowB = fakeMedia();
  claimLocalPlayback(asElement(rowB));
  assert.equal(rowA.pauseCalls, 1, "앞 줄이 멈춘다");
  assert.equal(rowB.pauseCalls, 0);
  resetPlayerForTests();
});

test("하단 미니 플레이어가 다시 재생을 시작하면 목록 줄 오디오가 멈춘다", () => {
  resetPlayerForTests();
  startTrack(LINK_TRACK);
  const row = fakeMedia();
  claimLocalPlayback(asElement(row));
  row.paused = false;
  resumeTrack();
  assert.equal(getPlayerState().playing, true);
  assert.equal(row.pauseCalls, 1);

  releaseLocalPlayback(asElement(row));
  row.paused = false;
  startTrack({ ...LINK_TRACK, key: "post-2" });
  assert.equal(row.pauseCalls, 1, "놓은 요소는 더 건드리지 않는다");
  resetPlayerForTests();
});

test("로그아웃하거나 다른 계정으로 바뀌면 앞 계정의 곡을 닫고, 같은 계정이면 그대로 둔다", () => {
  resetPlayerForTests();
  bindPlayerOwner("student-a");
  startTrack(LINK_TRACK);
  bindPlayerOwner("student-a");
  assert.equal(getPlayerState().track?.key, "post-1");

  bindPlayerOwner(null);
  assert.equal(getPlayerState().track, null, "로그아웃하면 닫는다");
  assert.equal(getPlayerState().playing, false);

  bindPlayerOwner("student-a");
  startTrack(LINK_TRACK);
  const row = fakeMedia();
  claimLocalPlayback(asElement(row));
  bindPlayerOwner("student-b");
  assert.equal(getPlayerState().track, null, "다른 계정이면 닫는다");
  assert.equal(row.pauseCalls, 1);
  resetPlayerForTests();
});
