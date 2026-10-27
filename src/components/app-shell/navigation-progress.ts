type ClickLike = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "target">;
type LocationLike = Pick<Location, "origin" | "pathname" | "search">;

/**
 * 위쪽 진행 막대를 켤 클릭인지 정한다. 같은 창에서 다른 앱 주소(경로나 query가 다름)로 가는 왼쪽 클릭만 해당한다.
 * 새 창·내려받기·외부 주소·같은 주소의 # 이동은 기다릴 화면이 없으므로 제외한다.
 */
export function isProgressNavigationClick(event: ClickLike, location: LocationLike): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null | undefined;
  if (!anchor) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download") || anchor.hasAttribute("data-progress-skip")) return false;
  let url: URL;
  try {
    url = new URL(anchor.getAttribute("href") ?? "", `${location.origin}${location.pathname}${location.search}`);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  return url.pathname !== location.pathname || url.search !== location.search;
}
