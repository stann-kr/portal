export type PersistLocalDraftOnShortcutOptions<T> = {
  createSnapshot: () => T;
  isEmpty: (snapshot: T) => boolean;
  clear: () => void;
  save: (snapshot: T) => void;
  flush: () => boolean;
};

/**
 * 공개·등록 action과 분리된 Cmd/Ctrl+S 로컬 초안 경계다.
 * 최신 snapshot을 즉시 queue·flush하되 빈 기본값은 남기지 않는다.
 */
export function persistLocalDraftOnShortcut<T>({
  createSnapshot,
  isEmpty,
  clear,
  save,
  flush,
}: PersistLocalDraftOnShortcutOptions<T>): "empty" | "saved" | "error" {
  const snapshot = createSnapshot();
  if (isEmpty(snapshot)) {
    clear();
    return "empty";
  }

  save(snapshot);
  return flush() ? "saved" : "error";
}
