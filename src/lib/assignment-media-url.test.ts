import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssignmentMediaUrl } from "./assignment-media-url";

const VIDEO_ID = "aqz-KE-bpKQ";

test("플레이어가 재생하는 YouTube 영상 주소를 받고 모바일·뮤직 host를 www로 맞춘다", () => {
  const cases: [string, string][] = [
    [`https://www.youtube.com/watch?v=${VIDEO_ID}&t=90s`, `https://www.youtube.com/watch?v=${VIDEO_ID}&t=90s`],
    [`http://youtube.com/watch?v=${VIDEO_ID}`, `https://www.youtube.com/watch?v=${VIDEO_ID}`],
    [`https://m.youtube.com/watch?v=${VIDEO_ID}`, `https://www.youtube.com/watch?v=${VIDEO_ID}`],
    [`https://music.youtube.com/watch?v=${VIDEO_ID}`, `https://www.youtube.com/watch?v=${VIDEO_ID}`],
    [`https://youtube.com/shorts/${VIDEO_ID}?si=share`, `https://www.youtube.com/shorts/${VIDEO_ID}?si=share`],
    [`https://www.youtube.com/live/${VIDEO_ID}`, `https://www.youtube.com/live/${VIDEO_ID}`],
    [`  https://youtu.be/${VIDEO_ID}?si=share  `, `https://youtu.be/${VIDEO_ID}?si=share`],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(normalizeAssignmentMediaUrl(input), { ok: true, url: expected }, input);
  }
});

test("SoundCloud 트랙·세트는 받고 모바일 host를 정규화하며 짧은 공유 링크는 이유를 안내한다", () => {
  assert.deepEqual(
    normalizeAssignmentMediaUrl("https://m.soundcloud.com/dj-name/sunday-mix"),
    { ok: true, url: "https://soundcloud.com/dj-name/sunday-mix" },
  );
  assert.deepEqual(
    normalizeAssignmentMediaUrl("https://soundcloud.com/dj-name/sets/warmup"),
    { ok: true, url: "https://soundcloud.com/dj-name/sets/warmup" },
  );
  const shortLink = normalizeAssignmentMediaUrl("https://on.soundcloud.com/AbCd1234");
  assert.equal(shortLink.ok, false);
  assert.match(shortLink.ok ? "" : shortLink.error, /on\.soundcloud\.com/u);
  assert.equal(normalizeAssignmentMediaUrl("https://soundcloud.com/dj-name").ok, false);
});

test("영상이 아닌 YouTube 주소와 다른 host·형식은 거부한다", () => {
  for (const value of [
    "",
    "not a url",
    "javascript:alert(1)",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/",
    "https://evil.example/watch?v=aqz-KE-bpKQ",
    "https://www.youtube.com.evil.example/watch?v=aqz-KE-bpKQ",
    "https://user:pass@youtube.com/watch?v=aqz-KE-bpKQ",
    `https://youtu.be/${VIDEO_ID}${"x".repeat(2_100)}`,
  ]) {
    assert.equal(normalizeAssignmentMediaUrl(value).ok, false, value);
  }
});
