/**
 * @file src/components/player/peaks-cache.ts
 * @description 파형 hook의 메모리 상한 도구. 최근 결과만 남기는 작은 LRU와, 디코딩을 한 번에 하나만 돌리는 직렬 큐.
 */

/** 최근에 쓴 `capacity`개만 남긴다. `get`은 최근으로 올리고 `has`는 순서를 바꾸지 않는다. */
export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as K;
      this.entries.delete(oldest);
    }
  }
}

/** 넘긴 작업을 앞 작업이 끝난 뒤(성공·실패 무관) 하나씩 실행한다. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
