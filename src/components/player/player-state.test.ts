import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_PLAYER_STATE,
  isMiniPlayerVisible,
  isPageActive,
  reducePlayer,
  type PlayerAction,
  type PlayerState,
  type PlayerTrack,
} from "./player-state";

const audioTrack: PlayerTrack = {
  key: "post-a", kind: "audio", url: "/api/media/a", title: "11월 테크노 셋", subtitle: "김학생", href: "/community/post-a", mediaObjectId: "a",
};
const videoTrack: PlayerTrack = {
  key: "post-b", kind: "youtube", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", title: "레퍼런스 셋", subtitle: "이학생", href: "/community/post-b", mediaObjectId: null,
};

function run(actions: PlayerAction[], from: PlayerState = INITIAL_PLAYER_STATE): PlayerState {
  return actions.reduce(reducePlayer, from);
}

test("게시물 화면에서 재생하면 화면이 맡고 미니 플레이어는 보이지 않는다", () => {
  const state = run([{ type: "page-mount", key: "post-a" }, { type: "start", track: audioTrack }]);
  assert.equal(state.owner, "page");
  assert.equal(isPageActive(state, "post-a"), true);
  assert.equal(isMiniPlayerVisible(state), false);
});

test("재생 중에 게시물을 떠나면 미니 플레이어가 그 위치부터 이어받고, 돌아오면 화면이 같은 위치로 다시 맡는다", () => {
  let state = run([
    { type: "page-mount", key: "post-b" },
    { type: "start", track: videoTrack },
    { type: "progress", key: "post-b", position: 754, duration: 3500, playing: true },
    { type: "page-unmount", key: "post-b" },
  ]);
  assert.equal(state.owner, "persistent");
  assert.equal(isMiniPlayerVisible(state), true);
  assert.deepEqual(state.resume?.seconds, 754, "새 미니 플레이어는 754초부터 이어 간다");
  const leaveNonce = state.resume?.nonce;

  state = run([{ type: "progress", key: "post-b", position: 800 }, { type: "page-mount", key: "post-b" }], state);
  assert.equal(state.owner, "page");
  assert.equal(isMiniPlayerVisible(state), false);
  assert.equal(state.resume?.seconds, 800, "돌아온 화면은 800초부터 이어 간다");
  assert.notEqual(state.resume?.nonce, leaveNonce, "같은 위치여도 새 요청이다");
});

test("멈춘 채로 떠나면 곡을 끝내고, 다른 게시물 화면은 지금 곡을 건드리지 않는다", () => {
  const paused = run([
    { type: "page-mount", key: "post-a" },
    { type: "start", track: audioTrack },
    { type: "progress", key: "post-a", playing: false, position: 30 },
    { type: "page-unmount", key: "post-a" },
  ]);
  assert.equal(paused.track, null);
  assert.equal(isMiniPlayerVisible(paused), false);

  const elsewhere = run([
    { type: "page-mount", key: "post-a" },
    { type: "start", track: audioTrack },
    { type: "page-unmount", key: "post-a" },
    { type: "page-mount", key: "post-b" },
  ]);
  assert.equal(elsewhere.track?.key, "post-a");
  assert.equal(elsewhere.owner, "persistent", "다른 게시물 화면에서도 미니 플레이어가 계속 재생한다");
  // 늦게 온 이전 화면의 unmount는 지금 화면 상태를 지우지 않는다.
  assert.equal(reducePlayer(elsewhere, { type: "page-unmount", key: "post-a" }), elsewhere);
});

test("다른 믹스셋을 재생하면 미니 플레이어의 곡을 바꾸고 화면이 맡는다", () => {
  const state = run([
    { type: "page-mount", key: "post-a" },
    { type: "start", track: audioTrack },
    { type: "progress", key: "post-a", position: 100, duration: 3000, playing: true },
    { type: "page-unmount", key: "post-a" },
    { type: "page-mount", key: "post-b" },
    { type: "start", track: videoTrack },
  ]);
  assert.equal(state.track?.key, "post-b");
  assert.equal(state.owner, "page");
  assert.equal(state.position, 0, "새 곡은 처음부터");
  assert.equal(state.duration, 0);
});

test("다른 곡의 위치 보고는 무시하고, 닫으면 곡과 재생 상태를 지운다", () => {
  const playing = run([{ type: "page-mount", key: "post-a" }, { type: "start", track: audioTrack, at: 3930 }]);
  assert.equal(playing.position, 3930);
  assert.equal(reducePlayer(playing, { type: "progress", key: "post-b", position: 1 }), playing);
  const closed = reducePlayer(playing, { type: "close" });
  assert.equal(closed.track, null);
  assert.equal(closed.playing, false);
  assert.equal(closed.pageKey, "post-a", "열린 화면 정보는 남긴다");
});

test("작은 창 접기는 소리와 무관하게 토글되고 새 곡에서는 다시 펼친다", () => {
  let state = run([{ type: "start", track: videoTrack }, { type: "toggle-video" }]);
  assert.equal(state.videoCollapsed, true);
  assert.equal(state.playing, true);
  state = reducePlayer(state, { type: "start", track: audioTrack });
  assert.equal(state.videoCollapsed, false);
});
