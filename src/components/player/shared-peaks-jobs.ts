/**
 * @file src/components/player/shared-peaks-jobs.ts
 * @description 주소별로 한 번만 돌리는 파형 계산 작업과 그 구독자 수. 같은 주소를 여러 화면이 기다리면 작업 하나를 나눠 쓰고,
 * 마지막 구독자가 떠났을 때 `keepAlive(url)`이 false면(공용 플레이어가 그 주소를 재생하지 않으면) AbortSignal로 멈춘다.
 * 멈춘 작업은 목록에서 빠지므로, 다음 구독자는 새 작업을 시작한다.
 */

export type SharedPeaksJob<T> = {
  promise: Promise<T>;
  /** 구독을 놓는다. 여러 번 불러도 한 번만 센다. */
  release(): void;
};

type Entry<T> = { promise: Promise<T>; controller: AbortController; subscribers: number; settled: boolean };

export function createSharedPeaksJobs<T>(options: {
  /** 작업 본문. signal이 멈추면 가능한 빨리 끝내고, 멈춘 결과를 실패로 기억하지 않는다. */
  run(url: string, signal: AbortSignal): Promise<T>;
  /** 구독자가 모두 떠나도 계속할지. */
  keepAlive(url: string): boolean;
}) {
  const jobs = new Map<string, Entry<T>>();

  function subscribe(url: string): SharedPeaksJob<T> {
    let entry = jobs.get(url);
    if (!entry) {
      const controller = new AbortController();
      const created: Entry<T> = { controller, subscribers: 0, settled: false, promise: Promise.resolve() as Promise<T> };
      created.promise = options.run(url, controller.signal).finally(() => {
        created.settled = true;
        if (jobs.get(url) === created) jobs.delete(url);
      });
      jobs.set(url, created);
      entry = created;
    }
    const current = entry;
    current.subscribers += 1;
    let released = false;
    return {
      promise: current.promise,
      release() {
        if (released) return;
        released = true;
        current.subscribers -= 1;
        if (current.settled || current.subscribers > 0 || options.keepAlive(url)) return;
        current.controller.abort();
        if (jobs.get(url) === current) jobs.delete(url);
      },
    };
  }

  return {
    subscribe,
    /** 테스트용: 이 주소의 작업이 돌고 있는지. */
    isRunning: (url: string) => jobs.has(url),
  };
}
