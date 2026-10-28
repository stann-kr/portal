const MAINTENANCE_HEALTH_PATH = "/__portal/maintenance/healthz";
const MAINTENANCE_READINESS_PATH = "/__portal/maintenance/readyz";
const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

type MaintenanceWorkerEnv = {
  CF_VERSION_METADATA?: MaintenanceVersionMetadata;
};

type MaintenanceVersionMetadata = {
  id: string;
  tag: string;
  timestamp: string;
};

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Portal-Mode": "maintenance",
} as const;

const MAINTENANCE_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>포탈 점검 중</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { display: grid; min-height: 100vh; margin: 0; place-items: center; }
      main { max-width: 34rem; padding: 2rem; }
      h1 { font-size: 1.5rem; }
      p { line-height: 1.7; }
    </style>
  </head>
  <body>
    <main>
      <h1>포탈을 점검하고 있습니다</h1>
      <p>데이터를 안전하게 전환하는 동안 읽기와 쓰기를 잠시 중단했습니다. 잠시 뒤 다시 시도해 주세요.</p>
    </main>
  </body>
</html>`;

function responseHeaders(contentType: string): Headers {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", contentType);
  return headers;
}

function responseBody(request: Request, body: string): string | null {
  return request.method === "HEAD" ? null : body;
}

function statusPayload(
  path: string,
  metadata: MaintenanceVersionMetadata | undefined,
): Record<string, unknown> {
  const version = {
    id: metadata?.id ?? null,
    tag: metadata?.tag || null,
  };
  if (path === MAINTENANCE_HEALTH_PATH) {
    return { status: "ok", mode: "maintenance", version };
  }
  return {
    status: "ok",
    mode: "maintenance",
    readyFor: "maintenance-fence",
    applicationReady: false,
    readsBlocked: true,
    writesBlocked: true,
    version,
  };
}

export function handleMaintenanceRequest(
  request: Request,
  env: MaintenanceWorkerEnv = {},
): Response {
  const { pathname } = new URL(request.url);
  const isStatusPath =
    pathname === MAINTENANCE_HEALTH_PATH ||
    pathname === MAINTENANCE_READINESS_PATH;

  if (isStatusPath && request.method !== "GET" && request.method !== "HEAD") {
    const headers = responseHeaders("text/plain; charset=utf-8");
    headers.set("Allow", "GET, HEAD");
    return new Response(responseBody(request, "Method Not Allowed"), {
      status: 405,
      headers,
    });
  }

  if (isStatusPath) {
    const headers = responseHeaders("application/json; charset=utf-8");
    const body = JSON.stringify(statusPayload(pathname, env.CF_VERSION_METADATA));
    return new Response(responseBody(request, body), { status: 200, headers });
  }

  const headers = responseHeaders("text/html; charset=utf-8");
  headers.set("Retry-After", String(MAINTENANCE_RETRY_AFTER_SECONDS));
  return new Response(responseBody(request, MAINTENANCE_HTML), {
    status: 503,
    headers,
  });
}

const maintenanceWorker = {
  fetch(request: Request, env: MaintenanceWorkerEnv) {
    return handleMaintenanceRequest(request, env);
  },
};

export default maintenanceWorker;
