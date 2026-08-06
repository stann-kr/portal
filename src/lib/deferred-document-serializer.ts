/**
 * 문서 변경 횟수와 전체 직렬화 결과를 분리한다.
 * 입력 경로는 markDirty()만 호출하고, draft flush·submit 경계의 read()가 revision당 한 번만 직렬화한다.
 */
export function createDeferredDocumentSerializer(initialSerialized: string) {
  let revision = 0;
  let cachedRevision = 0;
  let cachedSerialized = initialSerialized;

  return {
    markDirty(): void {
      revision += 1;
    },
    read(serialize: () => string): string {
      if (cachedRevision !== revision) {
        cachedSerialized = serialize();
        cachedRevision = revision;
      }
      return cachedSerialized;
    },
    replace(serialized: string): void {
      revision += 1;
      cachedRevision = revision;
      cachedSerialized = serialized;
    },
  };
}
