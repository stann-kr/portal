import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMixsetMedia,
  describeRevisionLinkChange,
  COMMENT_TIME_MARKER_MAX_SECONDS,
  formatTimeMarker,
  isMixsetLinkUrl,
  normalizeMixsetLinkUrl,
  parseTimeMarker,
} from "./community-mixset-media";

const FORMAT_ERROR = "재생 시점은 1:05:30, 12:34 또는 초(예: 754) 형식으로 입력해 주세요.";
const MAX_ERROR = "재생 시점은 23:59:59 이하로 입력해 주세요.";

test("재생 시점은 빈 값·초·m:ss·h:mm:ss를 받는다", () => {
  const cases: [unknown, number | null][] = [
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
    ["0", 0],
    ["754", 754],
    ["12:34", 754],
    [" 12:34 ", 754],
    ["1:05:30", 3930],
    ["23:59:59", COMMENT_TIME_MARKER_MAX_SECONDS],
    [String(COMMENT_TIME_MARKER_MAX_SECONDS), COMMENT_TIME_MARKER_MAX_SECONDS],
  ];
  for (const [raw, seconds] of cases) {
    assert.deepEqual(parseTimeMarker(raw), { ok: true, seconds }, String(raw));
  }
});

test("재생 시점은 음수·형식 오류를 형식 안내로, 상한 초과를 상한 안내로 거부한다", () => {
  for (const raw of ["-1", "1:60", "abc", "12:3", "1:2:3", "1.5", "12:34:56:01", 754]) {
    assert.deepEqual(parseTimeMarker(raw), { ok: false, error: FORMAT_ERROR }, String(raw));
  }
  for (const raw of ["24:00:00", "86400", "1440:00"]) {
    assert.deepEqual(parseTimeMarker(raw), { ok: false, error: MAX_ERROR }, raw);
  }
});

test("formatTimeMarker 결과는 parseTimeMarker가 같은 초로 다시 읽는다", () => {
  assert.equal(formatTimeMarker(0), "00:00");
  assert.equal(formatTimeMarker(754), "12:34");
  assert.equal(formatTimeMarker(3930), "1:05:30");
  assert.equal(formatTimeMarker(COMMENT_TIME_MARKER_MAX_SECONDS), "23:59:59");
  assert.equal(formatTimeMarker(-5), "00:00");
  assert.equal(formatTimeMarker(61.9), "01:01");
  for (const seconds of [0, 1, 59, 60, 754, 3599, 3600, 3930, 45_296, COMMENT_TIME_MARKER_MAX_SECONDS]) {
    assert.deepEqual(parseTimeMarker(formatTimeMarker(seconds)), { ok: true, seconds }, String(seconds));
  }
});

test("classifyMixsetMedia는 업로드 오디오·정규화된 링크·이전 방식 오디오·매체 없음을 구분한다", () => {
  const link = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
  assert.deepEqual(
    classifyMixsetMedia({ mediaUrl: "/api/media/1", mediaObjectId: "media-1" }),
    { kind: "audio", url: "/api/media/1" },
  );
  // 링크 형식이어도 업로드 객체가 있으면 오디오다.
  assert.deepEqual(classifyMixsetMedia({ mediaUrl: link, mediaObjectId: "media-1" }), { kind: "audio", url: link });
  assert.deepEqual(classifyMixsetMedia({ mediaUrl: link, mediaObjectId: null }), { kind: "link", url: link });
  assert.deepEqual(
    classifyMixsetMedia({ mediaUrl: "https://soundcloud.com/artist/set-name" }),
    { kind: "link", url: "https://soundcloud.com/artist/set-name" },
  );
  assert.deepEqual(
    classifyMixsetMedia({ mediaUrl: "https://cdn.example.com/legacy.mp3", mediaObjectId: null }),
    { kind: "audio", url: "https://cdn.example.com/legacy.mp3" },
  );
  // 정규화 전 표기(m.youtube.com)는 저장 표현과 달라 링크로 보지 않는다.
  assert.deepEqual(
    classifyMixsetMedia({ mediaUrl: "https://m.youtube.com/watch?v=aqz-KE-bpKQ", mediaObjectId: null }),
    { kind: "audio", url: "https://m.youtube.com/watch?v=aqz-KE-bpKQ" },
  );
  assert.equal(classifyMixsetMedia({ mediaUrl: null, mediaObjectId: null }), null);
  assert.equal(classifyMixsetMedia({ mediaUrl: "", mediaObjectId: "media-1" }), null);
});

test("isMixsetLinkUrl은 정규화 결과와 정확히 같은 주소만 링크로 본다", () => {
  assert.equal(isMixsetLinkUrl("https://youtu.be/aqz-KE-bpKQ"), true);
  assert.equal(isMixsetLinkUrl("https://m.soundcloud.com/artist/track"), false);
  assert.equal(isMixsetLinkUrl(""), false);
  assert.equal(isMixsetLinkUrl(null), false);
  assert.equal(isMixsetLinkUrl(undefined), false);
});

test("normalizeMixsetLinkUrl은 링크를 정규화하고 게시물 기준 안내 문구를 돌려준다", () => {
  assert.deepEqual(normalizeMixsetLinkUrl(" https://m.youtube.com/watch?v=aqz-KE-bpKQ "), {
    ok: true,
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  });
  assert.deepEqual(normalizeMixsetLinkUrl("https://soundcloud.com/artist/sets/name"), {
    ok: true,
    url: "https://soundcloud.com/artist/sets/name",
  });
  for (const raw of ["", "   ", null, undefined, 42]) {
    assert.deepEqual(normalizeMixsetLinkUrl(raw), { ok: false, error: "믹스셋 링크를 입력해 주세요." }, String(raw));
  }
  for (const raw of ["not a url", "https://vimeo.com/123", "ftp://soundcloud.com/a/b"]) {
    assert.deepEqual(
      normalizeMixsetLinkUrl(raw),
      { ok: false, error: "YouTube 영상 또는 SoundCloud 트랙·세트 링크만 올릴 수 있습니다." },
      raw,
    );
  }
  // 형식별 세부 안내는 과제 제출과 같은 문구를 그대로 쓴다.
  assert.deepEqual(normalizeMixsetLinkUrl("https://www.youtube.com/channel/abc"), {
    ok: false,
    error: "YouTube는 재생할 영상의 링크(영상·Shorts·라이브)를 붙여 넣어 주세요.",
  });
  assert.deepEqual(normalizeMixsetLinkUrl("https://soundcloud.com/artist"), {
    ok: false,
    error: "SoundCloud는 아티스트 페이지가 아닌 트랙이나 세트 링크를 붙여 넣어 주세요.",
  });
  const shortLink = normalizeMixsetLinkUrl("https://on.soundcloud.com/abc");
  assert.equal(shortLink.ok, false);
  assert.match(shortLink.ok ? "" : shortLink.error, /on\.soundcloud\.com/u);
  assert.deepEqual(normalizeMixsetLinkUrl(`https://youtu.be/${"a".repeat(2_100)}`), {
    ok: false,
    error: "링크가 너무 깁니다. 공유 링크를 다시 복사해 주세요.",
  });
});

test("이력의 링크 변경은 앞 버전과 비교해 링크만 바뀐 버전을 구분한다", () => {
  const base = { title: "금요일 믹스셋", contentHtml: "<p>본문</p>", mediaObjectId: null };
  const oldLink = { ...base, mediaUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" };
  const newLink = { ...base, mediaUrl: "https://soundcloud.com/stann/friday-set" };
  assert.deepEqual(describeRevisionLinkChange(newLink, oldLink), {
    from: oldLink.mediaUrl,
    to: newLink.mediaUrl,
    linkOnly: true,
  });
  assert.equal(describeRevisionLinkChange(newLink, undefined), null, "첫 기록은 비교 대상이 없다");
  assert.equal(describeRevisionLinkChange(oldLink, { ...oldLink }), null, "링크가 같으면 변경이 아니다");
  assert.equal(
    describeRevisionLinkChange({ ...oldLink, title: "새 제목" }, oldLink),
    null,
    "제목만 바뀐 버전은 링크 변경이 아니다",
  );
  assert.deepEqual(
    describeRevisionLinkChange({ ...newLink, title: "새 제목" }, oldLink),
    { from: oldLink.mediaUrl, to: newLink.mediaUrl, linkOnly: false },
    "제목과 링크가 함께 바뀌면 링크만의 변경이 아니다",
  );
  assert.equal(
    describeRevisionLinkChange(
      { ...base, mediaUrl: "/api/media/audio-2", mediaObjectId: "audio-2" },
      { ...base, mediaUrl: "/api/media/audio-1", mediaObjectId: "audio-1" },
    ),
    null,
    "업로드 오디오 교체는 링크 변경으로 보지 않는다",
  );
});
