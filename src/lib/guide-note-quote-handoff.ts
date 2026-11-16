/**
 * 가이드 화면에서 고른 인용을 노트 편집기로 넘기는 일회용 보관(브라우저 탭의 sessionStorage).
 * 인용 길이에 제한이 없어 주소에는 token만 싣고, 노트 편집기가 준비되면 한 번 꺼내 넣은 뒤 지운다.
 * 새로고침·뒤로 가기로 같은 주소를 다시 열어도 이미 꺼낸 token은 비어 있어 두 번 들어가지 않는다.
 */
export const GUIDE_QUOTE_PARAM = "guideQuote";
const STORAGE_PREFIX = "portal:guide-note-quote:";
/** 오래 남은 보관은 쓰지 않는다(다른 화면에서 한참 뒤 같은 주소를 다시 연 경우). */
const MAX_AGE_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9-]{8,64}$/u;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function createToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 인용 HTML을 보관하고 token을 돌려준다. 보관할 수 없으면 null(호출하는 쪽이 안내한다). */
export function stashGuideQuote(html: string, now = Date.now()): string | null {
  const store = storage();
  if (!store) return null;
  const token = createToken();
  try {
    store.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify({ html, at: now }));
    return token;
  } catch {
    return null;
  }
}

/** token의 인용을 꺼내고 바로 지운다. 없거나 오래됐거나 손상됐으면 null. */
export function takeGuideQuote(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  const store = storage();
  if (!store) return null;
  const key = `${STORAGE_PREFIX}${token}`;
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
    store.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { html?: unknown; at?: unknown };
    if (typeof parsed.html !== "string" || typeof parsed.at !== "number") return null;
    if (now - parsed.at > MAX_AGE_MS || parsed.at - now > MAX_AGE_MS) return null;
    return parsed.html;
  } catch {
    return null;
  }
}

/** 주소에서 token을 지운다(새로고침해도 다시 찾지 않게). */
export function stripGuideQuoteParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(GUIDE_QUOTE_PARAM)) return;
  url.searchParams.delete(GUIDE_QUOTE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** 넣고 노트 열기: 이미 있는 노트 또는 새 노트 화면 주소. */
export function guideQuoteNoteHref(input: {
  token: string;
  returnTo: string;
  target:
    | { kind: "note"; noteId: string }
    | { kind: "new"; studentId: string; asAdmin: boolean; group: boolean; title: string };
}): string {
  const params = new URLSearchParams();
  if (input.target.kind === "new") {
    params.set("title", input.target.title);
    if (input.target.group) params.set("space", "group");
  }
  params.set(GUIDE_QUOTE_PARAM, input.token);
  params.set("returnTo", input.returnTo);
  if (input.target.kind === "note") return `/dashboard/notes/${encodeURIComponent(input.target.noteId)}?${params.toString()}`;
  const base = input.target.asAdmin
    ? `/dashboard/admin/students/${encodeURIComponent(input.target.studentId)}/notes/new`
    : "/dashboard/student/notes/new";
  return `${base}?${params.toString()}`;
}
