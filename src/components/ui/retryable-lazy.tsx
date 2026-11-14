"use client";

import {
  Component,
  Suspense,
  lazy,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 화면 조각의 코드를 내려받지 못한 실패. 조각이 그려지다 난 오류와 구분하려고 따로 둔다. */
class LazyLoadError extends Error {
  constructor(cause: unknown) {
    super("화면 조각을 내려받지 못했습니다.", { cause });
    this.name = "LazyLoadError";
  }
}

type BoundaryProps = {
  failed: (retry: () => void) => ReactNode;
  onRetry: () => void;
  children: ReactNode;
};

/** 내려받기 실패만 그 자리에서 받는다. 그 밖의 오류는 다시 던져 route 오류 화면이 맡는다. */
class LazyLoadBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!(error instanceof LazyLoadError)) throw error;
    return this.props.failed(this.props.onRetry);
  }
}

/**
 * 열 때 따로 내려받는 화면 조각(캔버스 "코드 리뷰 2차 후속" ①).
 * 내려받기에 실패하면 화면 전체 오류로 넘기지 않고 그 자리에 `failed`를 보이고,
 * "다시 시도"는 그 조각만 다시 내려받는다. React.lazy는 실패를 기억하므로 다시 시도할 때 새로 만든다.
 */
export function retryableLazy<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
  options: { loading: ReactNode; failed: (retry: () => void) => ReactNode },
): ComponentType<Props> {
  const create = () =>
    lazy(() =>
      load().then(
        (component) => ({ default: component }),
        (cause: unknown) => {
          throw new LazyLoadError(cause);
        },
      ),
    );
  let generation = 0;
  let Current = create();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const readGeneration = () => generation;
  const retry = () => {
    generation += 1;
    Current = create();
    for (const listener of listeners) listener();
  };

  function RetryableLazy(props: Props) {
    const shown = useSyncExternalStore(subscribe, readGeneration, readGeneration);
    const Loaded = Current;
    return (
      <LazyLoadBoundary key={shown} failed={options.failed} onRetry={retry}>
        <Suspense fallback={options.loading}>
          <Loaded {...props} />
        </Suspense>
      </LazyLoadBoundary>
    );
  }
  return RetryableLazy;
}

/**
 * 내려받기 실패 안내(캔버스 "코드 리뷰 2차 후속" ①): 위험 색 한 줄과 "다시 시도".
 * `minHeight`를 주면 불러오는 중 자리와 같은 높이의 상자로 그린다(편집기 칸).
 */
export function LazyLoadFailed({
  message,
  description,
  minHeight,
  onRetry,
}: {
  message: string;
  description?: string;
  minHeight?: string;
  onRetry: () => void;
}) {
  const boxed = minHeight !== undefined;
  return (
    <div
      role="alert"
      style={boxed ? { minHeight } : undefined}
      className={cn(
        boxed
          ? "flex flex-col items-start justify-center gap-2 rounded-lg border border-border p-5"
          : "flex flex-wrap items-center gap-x-3 gap-y-2",
      )}
    >
      <p className="inline-flex items-center gap-1.5 text-ui text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {message}
      </p>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <Button type="button" variant="outline" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}
