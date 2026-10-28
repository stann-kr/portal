import assert from "node:assert/strict";
import test from "node:test";
import {
  DIGGING_PLAYLIST_NOTE_MAX_LENGTH,
  DIGGING_PLAYLIST_TITLE_MAX_LENGTH,
  DIGGING_TEXTAREA_MAX_LENGTH,
  clampDiggingPlaylistTitle,
  diggingPlaylistDisplayTitle,
  normalizeDiggingPlaylistUrl,
  parseDiggingPlaylistNote,
  parseDiggingPlaylistTitle,
  parseDiggingColumnInput,
  parseDiggingColumnValue,
  parseDiggingTrackInput,
  type DiggingColumnContract,
} from "./digging-contract";

const columns: DiggingColumnContract[] = [
  { id: "title", userId: "student-1", columnType: "text", options: null },
  {
    id: "mood",
    userId: "student-1",
    columnType: "select",
    options: JSON.stringify(["좋음", "보통"]),
  },
  { id: "rating", userId: "student-1", columnType: "rating", options: null },
  { id: "key", userId: "student-1", columnType: "camelot_key", options: null },
];

test("digging 컬럼 정의는 허용 type과 bounded select option만 받는다", () => {
  assert.deepEqual(
    parseDiggingColumnInput({
      name: "  무드 ",
      columnType: "select",
      options: ["좋음", "보통"],
    }),
    {
      ok: true,
      value: { name: "무드", columnType: "select", options: ["좋음", "보통"] },
    },
  );
  assert.equal(
    parseDiggingColumnInput({ name: "x", columnType: "rogue" }).ok,
    false,
  );
  assert.equal(
    parseDiggingColumnInput({ name: "x", columnType: "select", options: ["중복", "중복"] }).ok,
    false,
  );
});

test("column type별 값과 option ownership을 검증한다", () => {
  assert.equal(parseDiggingColumnValue(columns[1], "좋음").ok, true);
  assert.equal(parseDiggingColumnValue(columns[1], "관리자 임의값").ok, false);
  assert.equal(parseDiggingColumnValue(columns[2], 5).ok, true);
  assert.equal(parseDiggingColumnValue(columns[2], 6).ok, false);
  assert.equal(parseDiggingColumnValue(columns[3], "12B").ok, true);
  assert.equal(parseDiggingColumnValue(columns[3], "13A").ok, false);
  assert.equal(
    parseDiggingColumnValue(
      { id: "memo", userId: "student-1", columnType: "textarea", options: null },
      "x".repeat(DIGGING_TEXTAREA_MAX_LENGTH + 1),
    ).ok,
    false,
  );
});

test("track payload는 소유 컬럼만 받고 링크 protocol과 JSON 크기를 제한한다", () => {
  const valid = parseDiggingTrackInput(
    {
      linkUrl: "https://open.spotify.com/track/example",
      values: { title: "Track", mood: "좋음", rating: 4, key: "8A" },
    },
    columns,
  );
  assert.equal(valid.ok, true);

  assert.equal(
    parseDiggingTrackInput({ values: { rogue: "value" } }, columns).ok,
    false,
  );
  assert.equal(
    parseDiggingTrackInput(
      { linkUrl: "http://127.0.0.1/private", values: {} },
      columns,
    ).ok,
    false,
  );
});

test("플레이리스트 링크는 Beatport 공유·SoundCloud 세트만 표준 주소로 받는다", () => {
  for (const [input, url] of [
    ["https://www.beatport.com/playlists/share/11018932", "https://www.beatport.com/playlists/share/11018932"],
    [" https://beatport.com/playlists/share/11018932/?utm_source=x#top ", "https://www.beatport.com/playlists/share/11018932"],
    ["https://WWW.Beatport.com/playlists/share/42", "https://www.beatport.com/playlists/share/42"],
  ] as const) {
    assert.deepEqual(normalizeDiggingPlaylistUrl(input), { ok: true, provider: "beatport", url }, input);
  }
  for (const [input, url] of [
    ["https://soundcloud.com/stann/sets/warmup", "https://soundcloud.com/stann/sets/warmup"],
    ["https://m.soundcloud.com/stann/sets/warm-up_2/?si=abc&utm_medium=text", "https://soundcloud.com/stann/sets/warm-up_2"],
    ["https://www.soundcloud.com/Stann/sets/Warmup#t=1", "https://soundcloud.com/Stann/sets/Warmup"],
    ["https://soundcloud.com/stann/sets/warmup/s-AbC123xyz", "https://soundcloud.com/stann/sets/warmup/s-AbC123xyz"],
  ] as const) {
    assert.deepEqual(normalizeDiggingPlaylistUrl(input), { ok: true, provider: "soundcloud", url }, input);
  }
});

test("플레이리스트 링크는 http·포트·계정 정보·다른 host·트랙·단축 링크를 거부한다", () => {
  for (const input of [
    "",
    "not a url",
    "http://www.beatport.com/playlists/share/11018932",
    "https://www.beatport.com:8443/playlists/share/11018932",
    // 기본 포트도 원본에 적혀 있으면 거부한다(new URL은 :443을 지운다).
    "https://www.beatport.com:443/playlists/share/1",
    "https://soundcloud.com:443/a/sets/b",
    "https://soundcloud.com:/a/sets/b",
    "https://user@soundcloud.com:443/a/sets/b",
    "https:soundcloud.com:443/a/sets/b",
    "\u0001https://soundcloud.com:443/a/sets/b",
    "https://soundcloud.com/stann/sets/warm\tup",
    "https://user:pass@www.beatport.com/playlists/share/11018932",
    "https://evil.example/playlists/share/11018932",
    "https://www.beatport.com.evil.example/playlists/share/11018932",
    "https://api.beatport.com/playlists/share/11018932",
    "https://www.beatport.com/track/song/123",
    "https://www.beatport.com/playlists/share/abc",
    "https://www.beatport.com/playlists/share/1/extra",
    "https://soundcloud.com/stann/warmup-track",
    "https://soundcloud.com/stann/sets",
    "https://soundcloud.com/stann/sets/warmup/extra",
    "https://soundcloud.com/stann/sets/warmup/s-bad_token",
    "https://soundcloud.com/stann/sets/warm%20up",
    "https://on.soundcloud.com/AbCdE",
    "https://w.soundcloud.com/player/?url=https://soundcloud.com/stann/sets/warmup",
    "https://open.spotify.com/playlist/37i9dQZF1DX",
    `https://www.beatport.com/playlists/share/${"1".repeat(2_100)}`,
  ]) {
    const result = normalizeDiggingPlaylistUrl(input);
    assert.equal(result.ok, false, input);
  }
  const shortLink = normalizeDiggingPlaylistUrl("https://on.soundcloud.com/AbCdE");
  assert.ok(!shortLink.ok && shortLink.error.includes("단축 링크"));
  const track = normalizeDiggingPlaylistUrl("https://soundcloud.com/stann/warmup-track");
  assert.ok(!track.ok && track.error.includes("플레이리스트 링크"));
  assert.equal(normalizeDiggingPlaylistUrl(42).ok, false);
});

test("플레이리스트 제목·메모는 trim하고 빈 값은 null, 상한을 넘으면 거부한다", () => {
  assert.deepEqual(parseDiggingPlaylistTitle("  오프닝  "), { ok: true, value: "오프닝" });
  assert.deepEqual(parseDiggingPlaylistTitle("   "), { ok: true, value: null });
  assert.deepEqual(parseDiggingPlaylistTitle(undefined), { ok: true, value: null });
  assert.equal(parseDiggingPlaylistTitle("가".repeat(DIGGING_PLAYLIST_TITLE_MAX_LENGTH)).ok, true);
  assert.equal(parseDiggingPlaylistTitle("가".repeat(DIGGING_PLAYLIST_TITLE_MAX_LENGTH + 1)).ok, false);
  assert.equal(parseDiggingPlaylistTitle(3).ok, false);
  assert.deepEqual(parseDiggingPlaylistNote(" 첫 줄\n둘째 줄 "), { ok: true, value: "첫 줄\n둘째 줄" });
  assert.equal(parseDiggingPlaylistNote("a".repeat(DIGGING_PLAYLIST_NOTE_MAX_LENGTH + 1)).ok, false);
});

test("oEmbed 제목은 공백을 정리해 상한까지만 저장하고 기본 이름으로 대체한다", () => {
  assert.equal(clampDiggingPlaylistTitle("  Deep \n Picks "), "Deep Picks");
  assert.equal(clampDiggingPlaylistTitle(""), null);
  assert.equal(clampDiggingPlaylistTitle(undefined), null);
  assert.equal(clampDiggingPlaylistTitle("a".repeat(500))?.length, DIGGING_PLAYLIST_TITLE_MAX_LENGTH);
  const emoji = clampDiggingPlaylistTitle("a" + "🎧".repeat(150));
  assert.ok(emoji && emoji.length <= DIGGING_PLAYLIST_TITLE_MAX_LENGTH && !/[\uD800-\uDBFF]$/u.test(emoji));
  assert.equal(diggingPlaylistDisplayTitle({ provider: "beatport", title: null }), "Beatport 플레이리스트");
  assert.equal(diggingPlaylistDisplayTitle({ provider: "soundcloud", title: " " }), "SoundCloud 플레이리스트");
  assert.equal(diggingPlaylistDisplayTitle({ provider: "soundcloud", title: "Warmup" }), "Warmup");
});
