import assert from "node:assert/strict";
import test from "node:test";
import { fetchDiggingLinkMetadata, fetchSoundCloudPlaylistTitle } from "./digging-link-metadata";

test("허용된 oEmbed JSON만 bounded metadata로 반환한다", async () => {
  const requested: string[] = [];
  const result = await fetchDiggingLinkMetadata(
    "https://youtu.be/track-id",
    async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ title: "Track", author_name: "Artist" }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  );
  assert.equal(requested.length, 1);
  assert.deepEqual(result, { title: "Track", artist: "Artist", siteName: "YouTube" });
});

test("redirect는 매 hop의 허용 host를 다시 확인한다", async () => {
  let requests = 0;
  const result = await fetchDiggingLinkMetadata(
    "https://open.spotify.com/track/example",
    async () => {
      requests += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  );
  assert.equal(requests, 1);
  assert.deepEqual(result, {});
});

test("잘못된 content type과 byte 상한 초과 응답을 거부한다", async () => {
  const wrongType = await fetchDiggingLinkMetadata(
    "https://open.spotify.com/track/example",
    async () => new Response("not html", { headers: { "content-type": "text/plain" } }),
  );
  assert.deepEqual(wrongType, {});

  const oversized = await fetchDiggingLinkMetadata(
    "https://open.spotify.com/track/example",
    async () =>
      new Response("<title>Too large</title>", {
        headers: {
          "content-type": "text/html",
          "content-length": String(256 * 1024 + 1),
        },
      }),
  );
  assert.deepEqual(oversized, {});
});

test("SoundCloud 세트 제목은 oEmbed의 작성자 접미사만 떼고 다른 host는 요청하지 않는다", async () => {
  const requested: string[] = [];
  const title = await fetchSoundCloudPlaylistTitle(
    "https://soundcloud.com/stann/sets/warmup",
    async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ title: "Deep - House Picks by Stann", author_name: "Stann" }), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  assert.equal(title, "Deep - House Picks");
  assert.deepEqual(requested, [
    "https://soundcloud.com/oembed?url=https%3A%2F%2Fsoundcloud.com%2Fstann%2Fsets%2Fwarmup&format=json",
  ]);

  let otherRequests = 0;
  const countingFetch = async () => {
    otherRequests += 1;
    return new Response("{}", { headers: { "content-type": "application/json" } });
  };
  assert.equal(await fetchSoundCloudPlaylistTitle("https://www.beatport.com/playlists/share/11018932", countingFetch), null);
  assert.equal(await fetchSoundCloudPlaylistTitle("http://soundcloud.com/stann/sets/warmup", countingFetch), null);
  assert.equal(otherRequests, 0);

  assert.equal(
    await fetchSoundCloudPlaylistTitle("https://soundcloud.com/stann/sets/warmup", async () => new Response("no", { status: 404 })),
    null,
  );
  assert.equal(
    await fetchSoundCloudPlaylistTitle("https://soundcloud.com/stann/sets/warmup", async () => { throw new Error("network"); }),
    null,
  );
});
