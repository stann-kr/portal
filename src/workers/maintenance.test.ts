import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleMaintenanceRequest } from "./maintenance";

const ORIGIN = "https://portal.example";
const VERSION = {
  id: "00000000-0000-4000-8000-000000000001",
  tag: "maintenance-0012",
  timestamp: "2026-08-09T00:00:00.000Z",
};

function request(path: string, method = "GET", init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, { ...init, method });
}

function assertBaseHeaders(response: Response): void {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Portal-Mode"), "maintenance");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(
    response.headers.get("Content-Security-Policy") ?? "",
    /default-src 'none'/u,
  );
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Set-Cookie"), null);
}

test("maintenance health와 readiness는 GET/HEAD만 허용하고 version을 식별한다", async () => {
  const health = handleMaintenanceRequest(
    request("/__portal/maintenance/healthz"),
    { CF_VERSION_METADATA: VERSION },
  );
  assert.equal(health.status, 200);
  assertBaseHeaders(health);
  assert.deepEqual(await health.json(), {
    status: "ok",
    mode: "maintenance",
    version: { id: VERSION.id, tag: VERSION.tag },
  });

  const ready = handleMaintenanceRequest(
    request("/__portal/maintenance/readyz"),
    { CF_VERSION_METADATA: VERSION },
  );
  assert.deepEqual(await ready.json(), {
    status: "ok",
    mode: "maintenance",
    readyFor: "maintenance-fence",
    applicationReady: false,
    readsBlocked: true,
    writesBlocked: true,
    version: { id: VERSION.id, tag: VERSION.tag },
  });

  const head = handleMaintenanceRequest(
    request("/__portal/maintenance/readyz", "HEAD"),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const methodNotAllowed = handleMaintenanceRequest(
    request("/__portal/maintenance/healthz", "POST", {
      body: "do-not-read-this-body",
    }),
  );
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(methodNotAllowed.headers.get("Allow"), "GET, HEAD");
  assertBaseHeaders(methodNotAllowed);
});

test("maintenance는 app·asset·API의 모든 method를 503으로 차단한다", async () => {
  const cases = [
    ["/", "GET"],
    ["/login", "HEAD"],
    ["/_next/static/chunks/app.js", "GET"],
    ["/api/auth/session", "GET"],
    ["/api/account-cleanup/status", "POST"],
    ["/api/media/example", "OPTIONS"],
    ["/community/example", "PATCH"],
    ["/dashboard", "DELETE"],
  ] as const;

  for (const [path, method] of cases) {
    const response = handleMaintenanceRequest(request(path, method));
    assert.equal(response.status, 503, `${method} ${path}`);
    assert.equal(response.headers.get("Retry-After"), "300");
    assertBaseHeaders(response);
    if (method === "HEAD") assert.equal(await response.text(), "");
  }
});

test("maintenance 응답은 request query·cookie·body를 반사하지 않는다", async () => {
  const marker = "sensitive-request-marker";
  const response = handleMaintenanceRequest(
    request(`/?token=${marker}`, "POST", {
      body: marker,
      headers: { Cookie: `session=${marker}` },
    }),
  );
  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(marker, "u"));
  assert.match(body, /포털을 점검하고 있습니다/u);
});

test("maintenance upload config는 application asset·D1·R2·route를 포함하지 않는다", () => {
  const config = readFileSync("wrangler.maintenance.toml", "utf8");
  assert.match(config, /^name = "portal"$/mu);
  assert.match(config, /^main = "src\/workers\/maintenance\.ts"$/mu);
  assert.match(config, /^\[version_metadata\]$/mu);
  assert.doesNotMatch(config, /^\[assets\]$/mu);
  assert.doesNotMatch(config, /^\[\[d1_databases\]\]$/mu);
  assert.doesNotMatch(config, /^\[\[r2_buckets\]\]$/mu);
  assert.doesNotMatch(config, /^\[\[routes\]\]$/mu);
  assert.doesNotMatch(config, /^\[triggers\]$/mu);
});
