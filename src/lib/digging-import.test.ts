import assert from "node:assert/strict";
import test from "node:test";
import {
  DIGGING_IMPORT_SOUNDCLOUD_LIMIT,
  findDiggingImportColumns,
  isDiggingImportOnBoard,
  normalizeDiggingImportLink,
  parsePastedTrackList,
  readSoundCloudImportCandidates,
} from "./digging-import";

test("SoundCloud 곡은 정보가 온 앞 20곡만 쓰고, 제목의 '아티스트 - 제목'을 나누거나 올린 사람을 아티스트로 둔다", () => {
  const detailed = (index: number) => ({
    title: `Track ${index}`,
    permalink_url: `https://soundcloud.com/user-${index}/track-${index}?in=x/sets/y`,
    user: { username: `Uploader ${index}` },
  });
  const sounds: unknown[] = [
    { title: "Lane 8 - Midnight Drive", permalink_url: "https://soundcloud.com/lane8/midnight-drive", user: { username: "Label" } },
    { title: "Overtime", permalink_url: "https://soundcloud.com/kerri/overtime", user: { username: "Kerri Chandler" }, publisher_metadata: {} },
    { title: "Sun Tunnels (Edit)", permalink_url: "https://soundcloud.com/lord/sun", user: { username: "x" }, publisher_metadata: { artist: "Lord of the Isles" } },
    ...Array.from({ length: 25 }, (_, index) => detailed(index + 4)),
    { id: 99, kind: "track" }, // 위젯이 아직 정보를 채우지 않은 곡
  ];
  const result = readSoundCloudImportCandidates(sounds);
  assert.equal(result.total, 29);
  assert.equal(result.candidates.length, DIGGING_IMPORT_SOUNDCLOUD_LIMIT);
  assert.deepEqual(result.candidates.slice(0, 3), [
    { title: "Midnight Drive", artist: "Lane 8", linkUrl: "https://soundcloud.com/lane8/midnight-drive" },
    { title: "Overtime", artist: "Kerri Chandler", linkUrl: "https://soundcloud.com/kerri/overtime" },
    { title: "Sun Tunnels (Edit)", artist: "Lord of the Isles", linkUrl: "https://soundcloud.com/lord/sun" },
  ]);
  assert.equal(result.candidates[3].linkUrl, "https://soundcloud.com/user-4/track-4", "플레이리스트 위치(?in=) 꼬리는 뗀다");
  assert.deepEqual(readSoundCloudImportCandidates([{ id: 1 }, null, "x"]), { total: 3, candidates: [] });
});

test("붙여 넣은 목록은 한 줄에 '아티스트 - 제목'으로 나누고, 빈 줄은 건너뛰고, 나눌 수 없는 줄은 제목만 둔다", () => {
  const pasted = "Rival Consoles - Glass Floor\n\n  Moderat – Cold Water  \r\nFloorplan - Never Grow Old - Original Mix\nUntitled Groove\n";
  assert.deepEqual(parsePastedTrackList(pasted), [
    { title: "Glass Floor", artist: "Rival Consoles", linkUrl: null },
    { title: "Cold Water", artist: "Moderat", linkUrl: null },
    { title: "Never Grow Old - Original Mix", artist: "Floorplan", linkUrl: null },
    { title: "Untitled Groove", artist: "", linkUrl: null },
  ]);
  assert.equal(parsePastedTrackList("a - b\n".repeat(500)).length, 200, "한 번에 200줄까지만 읽는다");
});

test("보드에 있는 곡은 링크로, 링크가 없는 줄은 같은 트랙명·아티스트로 찾는다", () => {
  const columns = [
    { id: "c-title", name: "트랙명", columnType: "text" as const },
    { id: "c-artist", name: "아티스트", columnType: "text" as const },
    { id: "c-link", name: "링크", columnType: "link" as const },
  ];
  const ids = findDiggingImportColumns(columns);
  assert.deepEqual(ids, { titleId: "c-title", artistId: "c-artist", linkId: "c-link" });
  assert.deepEqual(findDiggingImportColumns([{ id: "x", name: "메모", columnType: "textarea" }]), { titleId: null, artistId: null, linkId: null });

  const tracks = [
    { linkUrl: "https://SoundCloud.com/kerri/overtime/", values: {} },
    { linkUrl: null, values: { "c-title": "Glass Floor", "c-artist": "Rival Consoles" } },
  ];
  assert.equal(isDiggingImportOnBoard({ title: "Overtime", artist: "Kerri Chandler", linkUrl: "https://soundcloud.com/kerri/overtime" }, tracks, ids), true);
  assert.equal(isDiggingImportOnBoard({ title: "Overtime", artist: "Kerri Chandler", linkUrl: "https://soundcloud.com/kerri/overtime-2" }, tracks, ids), false, "링크가 있으면 링크로만 찾는다");
  assert.equal(isDiggingImportOnBoard({ title: " glass floor ", artist: "RIVAL CONSOLES", linkUrl: null }, tracks, ids), true);
  assert.equal(isDiggingImportOnBoard({ title: "Glass Floor", artist: "Someone Else", linkUrl: null }, tracks, ids), false);
  assert.equal(normalizeDiggingImportLink("https://soundcloud.com/a/b?in=c/sets/d#t=1"), "https://soundcloud.com/a/b");
  assert.equal(normalizeDiggingImportLink("not a url"), null);
});
