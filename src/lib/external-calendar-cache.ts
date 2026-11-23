/**
 * 학생 공개 iCal 구독 원문(ICS)을 잠깐 보관한다. 관리자 홈·학생 상세·캘린더가 같은 구독을 짧은 간격으로
 * 여러 번 읽어도 바깥 서버에는 한 번만 요청한다(바깥 요청은 최대 수 초 걸린다).
 * - 같은 Worker isolate 안은 메모리, isolate 사이는 Cloudflare Cache API(`caches.default`, 있을 때만)에 둔다.
 * - 열쇠는 구독 id와 암호화된 주소의 SHA-256이다. 구독 주소를 바꾸면 열쇠가 달라져 옛 원문을 쓰지 않는다.
 *   원문 주소·학생 id는 열쇠에 넣지 않는다.
 * - 성공한 응답만 보관한다. 실패는 매번 다시 시도한다.
 * 권한 확인은 호출하는 쪽(fetchExternalItemsForUser를 부르는 action)이 먼저 한다.
 */

/** 보관 시간. 바깥 캘린더 변경은 최대 이만큼 늦게 보인다. */
export const EXTERNAL_ICS_CACHE_TTL_MS = 10 * 60_000;
/** isolate 메모리에 둘 구독 수 상한(가장 오래된 것부터 버린다). */
const MEMORY_CACHE_LIMIT = 32;
/** Cache API 열쇠 주소. 실제로 요청하지 않는 이름이다. */
const CACHE_KEY_ORIGIN = "https://external-ics-cache.invalid/";

type MemoryEntry = { ics: string; expiresAt: number };

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<string>>();

/** 테스트용: 메모리 보관과 진행 중 요청을 비운다. */
export function clearExternalIcsCache(): void {
  memory.clear();
  inflight.clear();
}

type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

function edgeCache(): EdgeCache | null {
  try {
    const storage = (globalThis as { caches?: { default?: EdgeCache } }).caches;
    return storage?.default ?? null;
  } catch {
    return null;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 구독 id·암호화된 주소로 보관 열쇠를 만든다. */
export async function externalIcsCacheKey(subscriptionId: string, encryptedUrl: string): Promise<string> {
  return sha256Hex(`${subscriptionId}\u0000${encryptedUrl}`);
}

function rememberInMemory(key: string, ics: string, now: number): void {
  memory.delete(key);
  memory.set(key, { ics, expiresAt: now + EXTERNAL_ICS_CACHE_TTL_MS });
  while (memory.size > MEMORY_CACHE_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * 보관한 원문이 있으면 그것을, 없으면 `load`로 받아 보관한 뒤 돌려준다. 같은 열쇠의 동시 요청은 하나로 합친다.
 * Cache API 읽기·쓰기 실패는 무시한다(바깥 요청으로 돌아간다).
 */
export async function readExternalIcsCached(
  key: string,
  load: () => Promise<string>,
  now: () => number = Date.now,
): Promise<string> {
  const remembered = memory.get(key);
  if (remembered && remembered.expiresAt > now()) return remembered.ics;
  if (remembered) memory.delete(key);

  const running = inflight.get(key);
  if (running) return running;

  const request = (async () => {
    const cache = edgeCache();
    const cacheRequest = new Request(`${CACHE_KEY_ORIGIN}${key}`);
    if (cache) {
      try {
        const hit = await cache.match(cacheRequest);
        if (hit) {
          const ics = await hit.text();
          rememberInMemory(key, ics, now());
          return ics;
        }
      } catch {
        // Cache API를 쓸 수 없으면 바깥 요청으로 받는다.
      }
    }
    const ics = await load();
    rememberInMemory(key, ics, now());
    if (cache) {
      try {
        await cache.put(cacheRequest, new Response(ics, {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            // Cache API는 private·no-store 응답을 보관하지 않는다. 열쇠 주소는 이 Worker의 cache.match로만 읽힌다.
            "cache-control": `max-age=${Math.floor(EXTERNAL_ICS_CACHE_TTL_MS / 1_000)}`,
          },
        }));
      } catch {
        // 보관하지 못해도 받은 원문은 그대로 쓴다.
      }
    }
    return ics;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}
