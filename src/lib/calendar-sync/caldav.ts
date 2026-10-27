/**
 * iCloud CalDAV client (Apple ID + 앱 암호, Basic auth).
 *
 * - 허용 host: `caldav.icloud.com`, `p<N>-caldav.icloud.com` (https, 기본 port만). 그 밖으로는 요청·redirect하지 않는다.
 * - redirect는 manual로 받아 허용 host 안에서만 최대 `maxRedirects`번, method·body·Depth를 유지해 다시 보낸다.
 * - credential은 Authorization header에만 들어가며 오류 message·reason에 넣지 않는다.
 * - calendarId = collection 절대 URL(끝 `/`), remoteId = 리소스 href path.
 * - cursor = JSON `{"v":1,"syncToken":"...","ctag":"..."}`. 증분은 RFC 6578 sync-collection,
 *   초기(cursor null)는 collection sync-token을 먼저 읽은 뒤 time-range calendar-query로 전체를 읽는다.
 */
import { buildIcsEvent, derivePortalResourceName, derivePortalUid, formatIcsUtc, parseIcsEvent, patchIcsEvent } from "./ics";
import {
  CALENDAR_SYNC_MAX_PAGES,
  CalendarAuthError,
  CalendarConflictError,
  CalendarNotFoundError,
  CalendarProviderError,
  CalendarRateLimitError,
  assertPullWindow,
  base64Encode,
  fetchText,
  fullResyncResult,
  normalizeRemoteEventInput,
  parseRetryAfter,
  type CalendarProviderClient,
  type FetchedText,
  type PullResult,
  type PullWindow,
  type RemoteCalendar,
  type RemoteEvent,
  type RemoteEventInput,
  type WriteResult,
} from "./types";
import {
  APPLE_ICAL_NS,
  CALDAV_NS,
  CALENDARSERVER_NS,
  DAV_NS,
  XmlParseError,
  childElement,
  childElements,
  escapeXml,
  parseXml,
  textContent,
  type XmlElement,
} from "./xml";

export const ICLOUD_CALDAV_ROOT = "https://caldav.icloud.com/";
const ICLOUD_HOST_PATTERN = /^(?:caldav|p\d{1,4}-caldav)\.icloud\.com$/u;
const DEFAULT_MAX_REDIRECTS = 3;
const MULTIGET_BATCH = 50;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isAllowedICloudHost(hostname: string): boolean {
  return ICLOUD_HOST_PATTERN.test(hostname.toLowerCase());
}

/** iCloud CalDAV 이외 URL·http·credential·비표준 port를 거부한다. */
export function assertICloudUrl(value: string, base?: string): URL {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new CalendarProviderError("iCloud URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !isAllowedICloudHost(url.hostname)) {
    throw new CalendarProviderError("iCloud URL host is not allowed");
  }
  url.hash = "";
  return url;
}

function basicAuthorization(appleId: string, password: string): string {
  const id = appleId.trim();
  const secret = password.trim();
  if (!id || !secret || id.includes(":") || /[\u0000-\u001F\u007F]/u.test(id + secret)) {
    throw new CalendarAuthError("iCloud credentials are invalid", { reason: "invalid_credentials" });
  }
  return `Basic ${base64Encode(new TextEncoder().encode(`${id}:${secret}`))}`;
}

// ── multistatus ────────────────────────────────────────────

export type DavPropstat = { status: number; prop: XmlElement | undefined };
export type DavResponse = {
  /** 요청 URL 기준으로 해석한 절대 URL */
  url: string;
  /** URL pathname(인코딩 유지) */
  path: string;
  /** response 수준 DAV:status(없으면 undefined) */
  status?: number;
  propstats: DavPropstat[];
  error?: XmlElement;
};

function parseStatusLine(value: string): number | undefined {
  const match = /^\s*HTTP\/\d(?:\.\d)?\s+(\d{3})/u.exec(value);
  return match ? Number(match[1]) : undefined;
}

function parseXmlOrThrow(text: string): XmlElement {
  try {
    return parseXml(text);
  } catch (error) {
    if (error instanceof XmlParseError) throw new CalendarProviderError("iCloud response is invalid", { reason: "xml" });
    throw error;
  }
}

/** WebDAV multistatus를 읽는다. href는 baseUrl로 해석하고 허용 host 밖이면 거부한다. */
export function parseMultistatus(text: string, baseUrl: string): { responses: DavResponse[]; syncToken?: string; root: XmlElement } {
  const root = parseXmlOrThrow(text);
  if (root.ns !== DAV_NS || root.name !== "multistatus") throw new CalendarProviderError("iCloud response is invalid", { reason: "multistatus" });
  const responses: DavResponse[] = [];
  for (const response of childElements(root, DAV_NS, "response")) {
    const href = textContent(childElement(response, DAV_NS, "href")).trim();
    if (!href) continue;
    const url = assertICloudUrl(href, baseUrl);
    const statusElement = childElement(response, DAV_NS, "status");
    const propstats = childElements(response, DAV_NS, "propstat").map((propstat) => ({
      status: parseStatusLine(textContent(childElement(propstat, DAV_NS, "status"))) ?? 0,
      prop: childElement(propstat, DAV_NS, "prop"),
    }));
    responses.push({
      url: url.toString(),
      path: url.pathname,
      ...(statusElement ? { status: parseStatusLine(textContent(statusElement)) } : {}),
      propstats,
      ...(childElement(response, DAV_NS, "error") ? { error: childElement(response, DAV_NS, "error") } : {}),
    });
  }
  const syncTokenElement = childElement(root, DAV_NS, "sync-token");
  const syncToken = syncTokenElement ? textContent(syncTokenElement).trim() : undefined;
  return { responses, ...(syncToken ? { syncToken } : {}), root };
}

/** 200 propstat 안의 prop element. */
export function okProp(response: DavResponse, ns: string, name: string): XmlElement | undefined {
  for (const propstat of response.propstats) {
    if (propstat.status < 200 || propstat.status >= 300) continue;
    const element = childElement(propstat.prop, ns, name);
    if (element) return element;
  }
  return undefined;
}

function okText(response: DavResponse, ns: string, name: string): string | undefined {
  const element = okProp(response, ns, name);
  if (!element) return undefined;
  const value = textContent(element).trim();
  return value || undefined;
}

function okHref(response: DavResponse, ns: string, name: string): string | undefined {
  const href = textContent(childElement(okProp(response, ns, name), DAV_NS, "href")).trim();
  return href ? assertICloudUrl(href, response.url).toString() : undefined;
}

function normalizeColor(value: string | undefined): string | undefined {
  const match = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/u.exec(value?.trim() ?? "");
  return match ? `#${match[1].toLowerCase()}` : undefined;
}

function hasPrivilege(privilegeSet: XmlElement | undefined, names: string[]): boolean {
  if (!privilegeSet) return false;
  return childElements(privilegeSet, DAV_NS, "privilege").some((privilege) =>
    privilege.children.some((child) => child.ns === DAV_NS && names.includes(child.name)),
  );
}

/** Depth 1 PROPFIND 결과에서 VEVENT를 담을 수 있는 캘린더 collection만 고른다. */
export function parseCalendarCollections(responses: DavResponse[]): Array<RemoteCalendar & { syncToken?: string; ctag?: string }> {
  const calendars: Array<RemoteCalendar & { syncToken?: string; ctag?: string }> = [];
  for (const response of responses) {
    const resourcetype = okProp(response, DAV_NS, "resourcetype");
    if (!childElement(resourcetype, CALDAV_NS, "calendar")) continue;
    if (childElement(resourcetype, CALDAV_NS, "schedule-inbox") || childElement(resourcetype, CALDAV_NS, "schedule-outbox")) continue;
    const components = okProp(response, CALDAV_NS, "supported-calendar-component-set");
    if (components) {
      const names = childElements(components, CALDAV_NS, "comp").map((comp) => (comp.attributes.name ?? "").toUpperCase());
      if (!names.includes("VEVENT")) continue;
    }
    const privileges = okProp(response, DAV_NS, "current-user-privilege-set");
    const url = response.url.endsWith("/") ? response.url : `${response.url}/`;
    const color = normalizeColor(okText(response, APPLE_ICAL_NS, "calendar-color"));
    const syncToken = okText(response, DAV_NS, "sync-token");
    const ctag = okText(response, CALENDARSERVER_NS, "getctag");
    calendars.push({
      id: url,
      name: okText(response, DAV_NS, "displayname") ?? "캘린더",
      ...(color ? { color } : {}),
      readOnly: privileges ? !hasPrivilege(privileges, ["all", "write", "write-content"]) : false,
      ...(syncToken ? { syncToken } : {}),
      ...(ctag ? { ctag } : {}),
    });
  }
  return calendars;
}

// ── request bodies ─────────────────────────────────────────

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
const PROPFIND_PRINCIPAL = `${XML_HEAD}<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const PROPFIND_HOME = `${XML_HEAD}<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const PROPFIND_CALENDARS = `${XML_HEAD}<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NS}" xmlns:cs="${CALENDARSERVER_NS}" xmlns:a="${APPLE_ICAL_NS}"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/><a:calendar-color/><d:current-user-privilege-set/></d:prop></d:propfind>`;
const PROPFIND_COLLECTION_STATE = `${XML_HEAD}<d:propfind xmlns:d="DAV:" xmlns:cs="${CALENDARSERVER_NS}"><d:prop><d:sync-token/><cs:getctag/></d:prop></d:propfind>`;
const PROPFIND_ETAG = `${XML_HEAD}<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`;

function calendarQueryBody(window: PullWindow): string {
  return `${XML_HEAD}<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NS}"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${formatIcsUtc(window.from)}" end="${formatIcsUtc(window.to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

function syncCollectionBody(syncToken: string): string {
  return `${XML_HEAD}<d:sync-collection xmlns:d="DAV:"><d:sync-token>${escapeXml(syncToken)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
}

function multigetBody(paths: string[]): string {
  const hrefs = paths.map((path) => `<d:href>${escapeXml(path)}</d:href>`).join("");
  return `${XML_HEAD}<c:calendar-multiget xmlns:d="DAV:" xmlns:c="${CALDAV_NS}"><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs}</c:calendar-multiget>`;
}

// ── cursor ─────────────────────────────────────────────────

type CalDavCursor = { v: 1; syncToken: string; ctag?: string };

export function encodeCalDavCursor(cursor: CalDavCursor): string {
  return JSON.stringify(cursor);
}

export function decodeCalDavCursor(value: string): CalDavCursor | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 || typeof record.syncToken !== "string" || !record.syncToken) return null;
    return { v: 1, syncToken: record.syncToken, ...(typeof record.ctag === "string" && record.ctag ? { ctag: record.ctag } : {}) };
  } catch {
    return null;
  }
}

function isInvalidSyncTokenResponse(result: FetchedText): boolean {
  if (![400, 403, 409, 410].includes(result.status)) return false;
  try {
    const root = parseXml(result.text);
    if (root.ns === DAV_NS && root.name === "error") {
      return Boolean(childElement(root, DAV_NS, "valid-sync-token"));
    }
  } catch {
    // 아래 fallback
  }
  return /valid-sync-token/u.test(result.text);
}

function statusError(result: FetchedText, context: string): Error {
  const status = result.status;
  if (status === 401) return new CalendarAuthError("iCloud credentials were rejected", { status });
  if (status === 404 || status === 410) return new CalendarNotFoundError(`iCloud ${context} was not found`, { status });
  if (status === 412) return new CalendarConflictError(`iCloud ${context} changed remotely`, { status });
  if (status === 429 || (status === 503 && result.headers.get("retry-after"))) {
    return new CalendarRateLimitError("iCloud is rate limited", { status, retryAfterSeconds: parseRetryAfter(result.headers.get("retry-after")) });
  }
  return new CalendarProviderError(`iCloud ${context} request failed`, { status });
}

export type ICloudCalendarClient = CalendarProviderClient & {
  /** principal·calendar-home-set을 찾는다(연결 확인용). 결과는 client 안에 cache한다. */
  discover(): Promise<{ principalUrl: string; calendarHomeUrl: string }>;
};

export function createICloudCalendarClient(options: {
  appleId: string;
  appSpecificPassword: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRedirects?: number;
  /** discovery 결과를 저장해 두었다면 넘겨 PROPFIND 2회를 생략한다. */
  calendarHomeUrl?: string;
  now?: () => Date;
}): ICloudCalendarClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const authorization = basicAuthorization(options.appleId, options.appSpecificPassword);
  const now = options.now ?? (() => new Date());
  let discovered: { principalUrl: string; calendarHomeUrl: string } | null = null;
  let knownHomeUrl = options.calendarHomeUrl ? assertICloudUrl(options.calendarHomeUrl).toString() : null;

  /** 401은 CalendarAuthError로 던지고 나머지 status는 caller가 판단한다. 반환 url은 redirect 뒤 최종 URL. */
  async function request(
    method: string,
    target: string,
    init: { body?: string; depth?: "0" | "1"; headers?: Record<string, string> } = {},
  ): Promise<FetchedText & { url: string }> {
    let url = assertICloudUrl(target).toString();
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const headers: Record<string, string> = {
        authorization,
        ...(init.body !== undefined ? { "content-type": "application/xml; charset=utf-8" } : {}),
        ...(init.depth ? { depth: init.depth } : {}),
        ...init.headers,
      };
      const result = await fetchText(fetchImpl, url, { method, headers, ...(init.body !== undefined ? { body: init.body } : {}) }, { timeoutMs: options.timeoutMs });
      if (REDIRECT_STATUSES.has(result.status)) {
        const location = result.headers.get("location");
        if (!location) throw new CalendarProviderError("iCloud redirect is invalid", { status: result.status });
        url = assertICloudUrl(location, url).toString();
        continue;
      }
      if (result.status === 401) throw new CalendarAuthError("iCloud credentials were rejected", { status: 401 });
      return { ...result, url };
    }
    throw new CalendarProviderError("iCloud redirected too many times");
  }

  async function multistatus(method: string, target: string, body: string, depth: "0" | "1", context: string) {
    const result = await request(method, target, { body, depth });
    if (result.status !== 207) throw statusError(result, context);
    return { ...parseMultistatus(result.text, result.url), url: result.url };
  }

  async function discover(): Promise<{ principalUrl: string; calendarHomeUrl: string }> {
    if (discovered) return discovered;
    const principalResponse = await multistatus("PROPFIND", ICLOUD_CALDAV_ROOT, PROPFIND_PRINCIPAL, "0", "principal");
    const principalUrl = principalResponse.responses.map((response) => okHref(response, DAV_NS, "current-user-principal")).find(Boolean);
    if (!principalUrl) throw new CalendarProviderError("iCloud principal was not found");
    const homeResponse = await multistatus("PROPFIND", principalUrl, PROPFIND_HOME, "0", "principal");
    const calendarHomeUrl = homeResponse.responses.map((response) => okHref(response, CALDAV_NS, "calendar-home-set")).find(Boolean);
    if (!calendarHomeUrl) throw new CalendarProviderError("iCloud calendar home was not found");
    discovered = { principalUrl, calendarHomeUrl: calendarHomeUrl.endsWith("/") ? calendarHomeUrl : `${calendarHomeUrl}/` };
    knownHomeUrl = discovered.calendarHomeUrl;
    return discovered;
  }

  function collectionUrl(calendarId: string): URL {
    const url = assertICloudUrl(calendarId);
    if (!url.pathname.endsWith("/") || url.search) throw new CalendarProviderError("iCloud calendar id is invalid");
    return url;
  }

  /** remoteId(href path)가 collection 바로 아래 리소스인지 확인하고 절대 URL을 돌려준다. */
  function resourceUrl(collection: URL, remoteId: string): URL {
    if (typeof remoteId !== "string" || !remoteId.startsWith("/")) throw new CalendarProviderError("Remote event id is invalid");
    const url = assertICloudUrl(remoteId, collection.toString());
    const rest = url.pathname.slice(collection.pathname.length);
    if (url.origin !== collection.origin || !url.pathname.startsWith(collection.pathname) || !rest || rest.includes("/") || url.search) {
      throw new CalendarProviderError("Remote event id is outside the calendar");
    }
    return url;
  }

  function isMember(collection: URL, path: string): boolean {
    if (!path.startsWith(collection.pathname)) return false;
    const rest = path.slice(collection.pathname.length);
    return Boolean(rest) && !rest.includes("/");
  }

  async function fetchEtag(url: string): Promise<string> {
    const response = await multistatus("PROPFIND", url, PROPFIND_ETAG, "0", "event");
    const etag = response.responses.map((entry) => okText(entry, DAV_NS, "getetag")).find(Boolean);
    if (!etag) throw new CalendarProviderError("iCloud did not return an ETag");
    return etag;
  }

  function eventsFromResponses(collection: URL, responses: DavResponse[], changed: Map<string, RemoteEvent>, deleted: Set<string>) {
    for (const response of responses) {
      if (!isMember(collection, response.path)) continue;
      if (response.status === 404) {
        changed.delete(response.path);
        deleted.add(response.path);
        continue;
      }
      const data = okProp(response, CALDAV_NS, "calendar-data");
      const etag = okText(response, DAV_NS, "getetag");
      if (!data || !etag) continue;
      let event: RemoteEvent | null;
      try {
        event = parseIcsEvent(textContent(data), { remoteId: response.path, etag });
      } catch {
        continue; // 깨진 리소스 하나 때문에 전체 동기화를 멈추지 않는다.
      }
      if (!event) continue;
      if (event.status === "cancelled") {
        changed.delete(response.path);
        deleted.add(response.path);
      } else {
        deleted.delete(response.path);
        changed.set(response.path, event);
      }
    }
  }

  async function collectionState(collection: URL): Promise<{ syncToken?: string; ctag?: string }> {
    const response = await multistatus("PROPFIND", collection.toString(), PROPFIND_COLLECTION_STATE, "0", "calendar");
    const self = response.responses.find((entry) => entry.path === collection.pathname) ?? response.responses[0];
    if (!self) return {};
    const syncToken = okText(self, DAV_NS, "sync-token");
    const ctag = okText(self, CALENDARSERVER_NS, "getctag");
    return { ...(syncToken ? { syncToken } : {}), ...(ctag ? { ctag } : {}) };
  }

  async function getResource(url: URL): Promise<{ ics: string; etag: string } | null> {
    const result = await request("GET", url.toString(), { headers: { accept: "text/calendar" } });
    if (result.status === 404 || result.status === 410) return null;
    if (result.status !== 200) throw statusError(result, "event");
    const etag = result.headers.get("etag") ?? (await fetchEtag(url.toString()));
    return { ics: result.text, etag };
  }

  async function put(url: URL, ics: string, condition: Record<string, string>): Promise<WriteResult> {
    const result = await request("PUT", url.toString(), {
      body: ics,
      headers: { "content-type": "text/calendar; charset=utf-8", ...condition },
    });
    if (result.status !== 200 && result.status !== 201 && result.status !== 204) throw statusError(result, "event");
    const etag = result.headers.get("etag") ?? (await fetchEtag(url.toString()));
    return { remoteId: url.pathname, etag };
  }

  function assertEtag(etag: string): string {
    if (typeof etag !== "string" || !etag || /[\r\n]/u.test(etag)) throw new CalendarProviderError("ETag is invalid");
    return etag;
  }

  return {
    kind: "ICLOUD",
    discover,

    async listCalendars(): Promise<RemoteCalendar[]> {
      const home = knownHomeUrl ?? (await discover()).calendarHomeUrl;
      const response = await multistatus("PROPFIND", home, PROPFIND_CALENDARS, "1", "calendar home");
      return parseCalendarCollections(response.responses).map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        ...(calendar.color ? { color: calendar.color } : {}),
        readOnly: calendar.readOnly,
      }));
    },

    async pull(calendarId: string, cursor: string | null, window: PullWindow): Promise<PullResult> {
      const collection = collectionUrl(calendarId);
      const changed = new Map<string, RemoteEvent>();
      const deleted = new Set<string>();

      if (cursor === null) {
        assertPullWindow(window);
        // token을 먼저 읽어야 query 도중 생긴 변경이 다음 증분에서 빠지지 않는다.
        const state = await collectionState(collection);
        if (!state.syncToken) throw new CalendarProviderError("iCloud calendar does not support sync", { reason: "no_sync_token" });
        const query = await multistatus("REPORT", collection.toString(), calendarQueryBody(window), "1", "calendar");
        eventsFromResponses(collection, query.responses, changed, new Set());
        return {
          changed: [...changed.values()],
          deletedRemoteIds: [],
          nextCursor: encodeCalDavCursor({ v: 1, syncToken: state.syncToken, ...(state.ctag ? { ctag: state.ctag } : {}) }),
          fullResync: false,
        };
      }

      const decoded = decodeCalDavCursor(cursor);
      if (!decoded) return fullResyncResult();
      const state = await collectionState(collection);
      if (state.syncToken && state.syncToken === decoded.syncToken && (!decoded.ctag || !state.ctag || decoded.ctag === state.ctag)) {
        return { changed: [], deletedRemoteIds: [], nextCursor: cursor, fullResync: false };
      }

      let token = decoded.syncToken;
      const changedEtags = new Map<string, string>();
      for (let page = 0; ; page += 1) {
        if (page >= CALENDAR_SYNC_MAX_PAGES) throw new CalendarProviderError("iCloud sync has too many pages");
        const result = await request("REPORT", collection.toString(), { body: syncCollectionBody(token), depth: "0" });
        if (isInvalidSyncTokenResponse(result)) return fullResyncResult();
        if (result.status !== 207) throw statusError(result, "calendar");
        const parsed = parseMultistatus(result.text, result.url);
        let truncated = false;
        for (const response of parsed.responses) {
          if (response.path === collection.pathname) {
            if (response.status === 507) truncated = true;
            continue;
          }
          if (!isMember(collection, response.path)) continue;
          if (response.status === 404) {
            changedEtags.delete(response.path);
            deleted.add(response.path);
            continue;
          }
          const etag = okText(response, DAV_NS, "getetag");
          if (etag) {
            deleted.delete(response.path);
            changedEtags.set(response.path, etag);
          }
        }
        if (!parsed.syncToken) throw new CalendarProviderError("iCloud sync response has no token");
        const advanced = parsed.syncToken !== token;
        token = parsed.syncToken;
        if (!truncated || !advanced) break;
      }

      const paths = [...changedEtags.keys()];
      for (let index = 0; index < paths.length; index += MULTIGET_BATCH) {
        const batch = paths.slice(index, index + MULTIGET_BATCH);
        const response = await multistatus("REPORT", collection.toString(), multigetBody(batch), "1", "calendar");
        eventsFromResponses(collection, response.responses, changed, deleted);
      }
      return {
        changed: [...changed.values()],
        deletedRemoteIds: [...deleted],
        nextCursor: encodeCalDavCursor({ v: 1, syncToken: token, ...(state.ctag ? { ctag: state.ctag } : {}) }),
        fullResync: false,
      };
    },

    async create(calendarId: string, rawInput: RemoteEventInput): Promise<WriteResult> {
      const collection = collectionUrl(calendarId);
      const input = normalizeRemoteEventInput(rawInput);
      const url = assertICloudUrl(`${await derivePortalResourceName(input.portalRef)}.ics`, collection.toString());
      const ics = buildIcsEvent(input, { uid: await derivePortalUid(input.portalRef), now: now() });
      // 같은 portalRef의 리소스가 이미 있으면 412 → CalendarConflictError(findByPortalRef로 복구).
      return put(url, ics, { "if-none-match": "*" });
    },

    async update(calendarId: string, remoteId: string, rawInput: RemoteEventInput, ifMatchEtag: string): Promise<WriteResult> {
      const collection = collectionUrl(calendarId);
      const url = resourceUrl(collection, remoteId);
      const expected = assertEtag(ifMatchEtag);
      const current = await getResource(url);
      if (!current) throw new CalendarNotFoundError("iCloud event was not found", { status: 404 });
      if (current.etag !== expected) throw new CalendarConflictError("iCloud event changed remotely", { status: 412 });
      // 기존 UID·알림 등을 보존한다. 반복 일정은 patchIcsEvent가 거부한다.
      const ics = patchIcsEvent(current.ics, rawInput, { now: now() });
      return put(url, ics, { "if-match": expected });
    },

    async remove(calendarId: string, remoteId: string, ifMatchEtag: string): Promise<void> {
      const collection = collectionUrl(calendarId);
      const url = resourceUrl(collection, remoteId);
      const result = await request("DELETE", url.toString(), { headers: { "if-match": assertEtag(ifMatchEtag) } });
      if (result.status === 200 || result.status === 204) return;
      throw statusError(result, "event");
    },

    async findByPortalRef(calendarId: string, portalRef: string): Promise<RemoteEvent | null> {
      const collection = collectionUrl(calendarId);
      const input = normalizeRemoteEventInput({ title: "-", start: new Date(0), end: new Date(0), portalRef });
      const url = assertICloudUrl(`${await derivePortalResourceName(input.portalRef)}.ics`, collection.toString());
      const current = await getResource(url);
      if (!current) return null;
      const event = parseIcsEvent(current.ics, { remoteId: url.pathname, etag: current.etag });
      return event && event.status !== "cancelled" ? event : null;
    },
  };
}
