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
