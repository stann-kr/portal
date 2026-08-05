export type OpenConnection = {
  readonly open: boolean;
  close: () => void;
};

export type CachedOpenConnection<T extends OpenConnection> = {
  connection: T;
  fileIdentity: string;
};

/** Wrangler 내부 metadata DB를 제외하고 앱 D1 파일을 결정적으로 선택한다. */
export function selectLocalD1SqliteFile(fileNames: readonly string[]): string {
  const candidates = fileNames
    .filter(
      (fileName) =>
        fileName.endsWith(".sqlite") &&
        fileName.toLowerCase() !== "metadata.sqlite",
    )
    .sort();

  if (candidates.length !== 1) {
    throw new Error(
      `Wrangler 앱 D1 SQLite 파일이 정확히 1개여야 합니다. 현재 ${candidates.length}개입니다.`,
    );
  }

  return candidates[0]!;
}

/**
 * 경로와 파일 identity가 같은 열린 로컬 연결만 재사용한다.
 * 닫혔거나 파일이 교체된 연결은 닫고 새 연결로 교체한다.
 */
export function getOrCreateOpenConnection<T extends OpenConnection>(
  cache: Map<string, CachedOpenConnection<T>>,
  key: string,
  fileIdentity: string,
  create: () => T,
): T {
  const cached = cache.get(key);
  if (cached?.connection.open && cached.fileIdentity === fileIdentity) {
    return cached.connection;
  }

  if (cached?.connection.open) cached.connection.close();

  const connection = create();
  cache.set(key, { connection, fileIdentity });
  return connection;
}
