import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createCalendarClientForConnection, type StoredCalendarConnection } from "./client-factory";
import { decryptConnectionCredentials, encryptConnectionCredentials } from "./credentials";
import { jsonResponse } from "./fake-fetch";
import { GOOGLE_TOKEN_ENDPOINT } from "./google";
import { createSqliteTestDb, insertProfile, type SqliteTestDb } from "./sqlite-test-db";

const KEY = new Uint8Array(32).fill(9);
const CONNECTION_ID = "conn-google";
const ENV_NAMES = ["EXTERNAL_CALENDAR_ENCRYPTION_KEY", "GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "AUTH_URL"] as const;

type TokenCall = { refreshToken: string | null; respond: (body: Record<string, unknown>) => void };

/** 실제 Google 대신: token endpoint는 test가 직접 응답하고, 캘린더 목록은 사용한 access token을 기록한다. */
function installGoogleFetch(context: TestContext) {
  const previousFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY = Buffer.from(KEY).toString("base64");
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  process.env.AUTH_URL = "https://portal.example.com";
  const tokenCalls: TokenCall[] = [];
  const bearers: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === GOOGLE_TOKEN_ENDPOINT) {
      return new Promise<Response>((resolve) => {
        tokenCalls.push({
          refreshToken: new URLSearchParams(String(init?.body ?? "")).get("refresh_token"),
          respond: (body) => resolve(jsonResponse(body)),
        });
      });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
      bearers.push(new Headers(init?.headers).get("authorization") ?? "");
      return jsonResponse({ items: [] });
    }
    throw new Error("unexpected request");
  }) as typeof fetch;
  context.after(() => {
    globalThis.fetch = previousFetch;
    for (const name of ENV_NAMES) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  });
  return { tokenCalls, bearers };
}

async function storeGoogleConnection(db: SqliteTestDb): Promise<StoredCalendarConnection> {
  insertProfile(db, "admin-1", "admin");
  const sealed = await encryptConnectionCredentials({
    connectionId: CONNECTION_ID,
    provider: "GOOGLE",
    credentials: { refreshToken: "refresh-1", accessToken: "access-expired", accessTokenExpiresAt: 0 },
    key: KEY,
  });
  db.run(
    "INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv) VALUES (?, 'admin-1', 'GOOGLE', 'teacher@example.com', ?, ?)",
    CONNECTION_ID,
    sealed.encryptedCredentials,
    sealed.credentialsIv,
  );
  return { id: CONNECTION_ID, provider: "GOOGLE", ...sealed };
}

async function storedRefreshToken(db: SqliteTestDb): Promise<string> {
  const [row] = db.rows<{ encrypted_credentials: string; credentials_iv: string }>(
    "SELECT encrypted_credentials, credentials_iv FROM calendar_connections WHERE id = ?",
    CONNECTION_ID,
  );
  const credentials = await decryptConnectionCredentials({
    connectionId: CONNECTION_ID,
    provider: "GOOGLE",
    encryptedCredentials: row.encrypted_credentials,
    credentialsIv: row.credentials_iv,
    key: KEY,
  });
  return credentials.refreshToken;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 200; tick += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("기다린 요청이 오지 않았다");
}

test("두 client가 동시에 token을 갱신해도 늦게 끝난 쪽이 회전된 refresh token을 이전 값으로 되돌리지 않는다(CAS)", async (context) => {
  const google = installGoogleFetch(context);
  const db = createSqliteTestDb(context);
  const stale = await storeGoogleConnection(db);
  // 두 매핑·요청이 같은(만료된) 저장값으로 각자 client를 만든다.
  const clientA = await createCalendarClientForConnection(db.ctx, stale);
  const clientB = await createCalendarClientForConnection(db.ctx, stale);

  const listA = clientA.listCalendars();
  await waitFor(() => google.tokenCalls.length === 1);
  const listB = clientB.listCalendars();
  await waitFor(() => google.tokenCalls.length === 2);
  assert.deepEqual(google.tokenCalls.map((call) => call.refreshToken), ["refresh-1", "refresh-1"]);

  // A의 응답에 회전된 refresh token이 오고, B의 응답에는 회전이 없다.
  google.tokenCalls[0].respond({ access_token: "access-a", expires_in: 3600, refresh_token: "refresh-2" });
  await listA;
  assert.equal(await storedRefreshToken(db), "refresh-2");
  google.tokenCalls[1].respond({ access_token: "access-b", expires_in: 3600 });
  await listB;
  assert.equal(await storedRefreshToken(db), "refresh-2", "늦게 끝난 갱신이 이전 refresh token으로 덮지 않는다");
  assert.deepEqual(google.bearers, ["Bearer access-a", "Bearer access-b"]);

  // 오래된 저장값으로 만든 다른 client도 갱신 전에 저장값을 다시 읽어 유효한 token을 재사용한다.
  const clientC = await createCalendarClientForConnection(db.ctx, stale);
  const listC = clientC.listCalendars();
  // (회귀 시 C가 refresh를 부르면 응답해 test가 멈추지 않게 한다.)
  await waitFor(() => {
    for (const call of google.tokenCalls.slice(2)) call.respond({ access_token: "access-c", expires_in: 3600 });
    return google.bearers.length === 3;
  });
  await listC;
  assert.equal(google.tokenCalls.length, 2, "다른 client가 이미 받은 token이 유효하면 refresh하지 않는다");
  assert.equal(google.bearers[2], "Bearer access-a");
  assert.equal(await storedRefreshToken(db), "refresh-2");
});
