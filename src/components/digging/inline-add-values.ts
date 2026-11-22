type NamedColumn = { id: string; name: string };
type LinkMeta = { title?: string | null; artist?: string | null };

/**
 * 링크에서 읽은 트랙명·아티스트를 비어 있는 칸에만 채운다.
 * 요청을 보낼 때의 값이 아니라 응답이 온 시점의 값을 받아야, 기다리는 동안 직접 입력한 글자를 덮지 않는다.
 */
export function fillEmptyFromLinkMeta(
  values: Record<string, unknown>,
  columns: readonly NamedColumn[],
  meta: LinkMeta,
): Record<string, unknown> {
  let next = values;
  for (const [name, text] of [["트랙명", meta.title], ["아티스트", meta.artist]] as const) {
    const column = columns.find((candidate) => candidate.name === name);
    if (!text || !column || next[column.id]) continue;
    next = { ...next, [column.id]: text };
  }
  return next;
}

/** 숫자 칸의 입력값. 지운 칸은 0이 아니라 빈 값이다(`Number("")`는 0이라 그대로 쓰면 지운 칸이 0으로 저장된다). */
export function numberCellValue(text: string): number | "" {
  return text.trim() === "" ? "" : Number(text);
}

/** 링크도 칸 값도 없으면 추가하지 않는다(빈 Enter로 빈 트랙이 생기지 않게). */
export function hasTrackInput(linkUrl: string, values: Record<string, unknown>): boolean {
  if (linkUrl.trim()) return true;
  return Object.values(values).some((value) =>
    value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)
    && !(typeof value === "string" && value.trim() === ""));
}

/**
 * 저장 전에 링크 정보를 읽어야 하는지. 링크 칸이 blur되기 전에 Enter·추가를 누르면
 * 트랙명·아티스트가 아직 비어 있으므로, 둘 중 있는 칸이 비었으면 저장 전에 읽어 채운다.
 */
export function needsLinkMeta(linkUrl: string, values: Record<string, unknown>, columns: readonly NamedColumn[]): boolean {
  if (!/^https?:\/\//i.test(linkUrl.trim())) return false;
  return ["트랙명", "아티스트"].some((name) => {
    const column = columns.find((candidate) => candidate.name === name);
    return column !== undefined && !values[column.id];
  });
}
