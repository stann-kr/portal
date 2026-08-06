import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  FORM_DRAFT_CLEAR_MARKER_TTL_MS,
  FORM_DRAFT_CLEAR_MARKER_VERSION,
  FORM_DRAFT_RECOVERY_TTL_MS,
  createDocumentDraftKey,
  createFormDraftDataSignature,
  createFormDraftClearMarkerEntryKey,
  createFormDraftClearMarkerKey,
  createImmutableFormDraftRecoveryKey,
  createFormDraftRecoveryKey,
  createFormDraftRecoveryPrefix,
  isFormDraftClearMarkerKey,
  parseFormDraft,
  readFormDraftClearMarker,
  readFormDraftClearMarkers,
  removeFormDraftClearMarker,
  serializeFormDraft,
  writeFormDraftClearMarker,
} from "@/lib/form-draft";
import {
  FORM_DRAFT_MAX_WAIT_MS,
  useFormDraft,
} from "@/lib/hooks/useFormDraft";
import { useDeferredEditorContent } from "@/lib/hooks/useDeferredEditorContent";
import { isRichTextEmpty } from "@/lib/rich-text";

type DraftData = {
  operationId?: string;
  title: string;
  contentHtml: string;
};

type DraftHookResult = ReturnType<typeof useFormDraft<DraftData>>;

type DeferredIdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type DeferredIdleCallback = (deadline: DeferredIdleDeadline) => void;

const GLOBAL_BINDINGS = [
  "window",
  "document",
  "navigator",
  "CustomEvent",
  "StorageEvent",
  "Event",
  "Node",
  "HTMLElement",
  "MutationObserver",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];

type DraftHookHarness = {
  browserWindow: Window;
  getResult: (index?: number) => DraftHookResult;
  restoredDrafts: DraftData[];
  resetCounts: number[];
  render: (draftKey: string) => Promise<void>;
  renderKeys: (draftKeys: readonly string[]) => Promise<void>;
  remount: (draftKey: string, nextInstanceCount?: number) => Promise<void>;
  pendingIdleWorkCount: () => number;
  cancelledIdleWorkCount: () => number;
  runNextIdleWork: (options?: {
    didTimeout?: boolean;
    timeRemainingMs?: number;
  }) => Promise<void>;
  runNextCancelledIdleWork: (options?: {
    didTimeout?: boolean;
    timeRemainingMs?: number;
  }) => Promise<void>;
  unmount: () => Promise<void>;
};

type DraftHookTimingOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  blockLocalStorageAccessor?: boolean;
  deferArtifactSweepIdleWork?: boolean;
};

function draft(title: string): DraftData {
  return { title, contentHtml: `<p>${title}</p>` };
}

function installBrowserGlobals(browserWindow: Window): () => void {
  const previousDescriptors = new Map<GlobalBinding, PropertyDescriptor | undefined>();
  const bindings: Record<GlobalBinding, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    CustomEvent: browserWindow.CustomEvent,
    StorageEvent: browserWindow.StorageEvent,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    HTMLElement: browserWindow.HTMLElement,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  for (const name of GLOBAL_BINDINGS) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: bindings[name],
    });
  }

  return () => {
    for (const name of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previousDescriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

async function createDraftHookHarness(
  context: TestContext,
  initialKey: string | readonly string[],
  seed?: (storage: Storage) => void,
  instanceCount = 1,
  timing: DraftHookTimingOptions = {},
): Promise<DraftHookHarness> {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  const restoreBrowserGlobals = installBrowserGlobals(browserWindow);
  const seedStorage = browserWindow.localStorage;
  seed?.(seedStorage);
  const deferredIdleWork = new Map<number, DeferredIdleCallback>();
  const cancelledIdleWork = new Map<number, DeferredIdleCallback>();
  let nextIdleHandle = 0;
  const requestIdleCallbackDescriptor = Object.getOwnPropertyDescriptor(
    browserWindow,
    "requestIdleCallback",
  );
  const cancelIdleCallbackDescriptor = Object.getOwnPropertyDescriptor(
    browserWindow,
    "cancelIdleCallback",
  );
  if (timing.deferArtifactSweepIdleWork) {
    Object.defineProperty(browserWindow, "requestIdleCallback", {
      configurable: true,
      value: (callback: DeferredIdleCallback) => {
        const handle = ++nextIdleHandle;
        deferredIdleWork.set(handle, callback);
        return handle;
      },
    });
    Object.defineProperty(browserWindow, "cancelIdleCallback", {
      configurable: true,
      value: (handle: number) => {
        const callback = deferredIdleWork.get(handle);
        if (!callback) return;
        deferredIdleWork.delete(handle);
        cancelledIdleWork.set(handle, callback);
      },
    });
  }
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(
    browserWindow,
    "localStorage",
  );
  if (timing.blockLocalStorageAccessor) {
    Object.defineProperty(browserWindow, "localStorage", {
      configurable: true,
      get: () => {
        const error = new Error("localStorage accessor denied");
        error.name = "SecurityError";
        throw error;
      },
    });
  }

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  const restoredDrafts: DraftData[] = [];
  const resetCounts = Array.from({ length: instanceCount }, () => 0);
  const currentResults: Array<DraftHookResult | null> = Array.from(
    { length: instanceCount },
    () => null,
  );
  let mounted = true;
  let renderGeneration = 0;
  let activeInstanceCount = instanceCount;

  function Probe({ draftKey, index }: { draftKey: string; index: number }) {
    currentResults[index] = useFormDraft<DraftData>(
      draftKey,
      (restoredDraft) => restoredDrafts.push(restoredDraft),
      {
        debounceMs: timing.debounceMs ?? 60_000,
        maxWaitMs: timing.maxWaitMs,
        onReset: () => {
          resetCounts[index] += 1;
        },
      },
    );
    return null;
  }

  const renderKeys = async (draftKeys: readonly string[]) => {
    assert.equal(mounted, true, "unmount된 hook harness는 다시 render할 수 없습니다.");
    assert.equal(draftKeys.length, activeInstanceCount);
    await act(async () => {
      root.render(
        <>
          {Array.from({ length: activeInstanceCount }, (_, index) => (
            <Probe
              key={`${renderGeneration}:${index}`}
              draftKey={draftKeys[index]!}
              index={index}
            />
          ))}
        </>,
      );
    });
  };

  const render = async (draftKey: string) => {
    await renderKeys(Array.from({ length: activeInstanceCount }, () => draftKey));
  };

  const remount = async (draftKey: string, nextInstanceCount = instanceCount) => {
    renderGeneration += 1;
    activeInstanceCount = nextInstanceCount;
    currentResults.length = nextInstanceCount;
    currentResults.fill(null);
    while (resetCounts.length < nextInstanceCount) resetCounts.push(0);
    await render(draftKey);
  };

  const unmount = async () => {
    if (!mounted) return;
    await act(async () => {
      root.unmount();
    });
    mounted = false;
  };

  context.after(async () => {
    await unmount();
    if (timing.blockLocalStorageAccessor) {
      if (localStorageDescriptor) {
        Object.defineProperty(
          browserWindow,
          "localStorage",
          localStorageDescriptor,
        );
      } else {
        Reflect.deleteProperty(browserWindow, "localStorage");
      }
    }
    if (timing.deferArtifactSweepIdleWork) {
      if (requestIdleCallbackDescriptor) {
        Object.defineProperty(
          browserWindow,
          "requestIdleCallback",
          requestIdleCallbackDescriptor,
        );
      } else {
        Reflect.deleteProperty(browserWindow, "requestIdleCallback");
      }
      if (cancelIdleCallbackDescriptor) {
        Object.defineProperty(
          browserWindow,
          "cancelIdleCallback",
          cancelIdleCallbackDescriptor,
        );
      } else {
        Reflect.deleteProperty(browserWindow, "cancelIdleCallback");
      }
    }
    browserWindow.close();
    restoreBrowserGlobals();
  });

  if (typeof initialKey === "string") await render(initialKey);
  else await renderKeys(initialKey);

  return {
    browserWindow,
    restoredDrafts,
    resetCounts,
    render,
    renderKeys,
    remount,
    pendingIdleWorkCount: () => deferredIdleWork.size,
    cancelledIdleWorkCount: () => cancelledIdleWork.size,
    runNextIdleWork: async ({
      didTimeout = false,
      timeRemainingMs = 100,
    } = {}) => {
      const work = deferredIdleWork.entries().next().value as
        | [number, DeferredIdleCallback]
        | undefined;
      assert.ok(work, "실행할 deferred idle callback이 없습니다.");
      const [handle, callback] = work;
      deferredIdleWork.delete(handle);
      await act(async () => {
        callback({
          didTimeout,
          timeRemaining: () => timeRemainingMs,
        });
      });
    },
    runNextCancelledIdleWork: async ({
      didTimeout = false,
      timeRemainingMs = 100,
    } = {}) => {
      const work = cancelledIdleWork.entries().next().value as
        | [number, DeferredIdleCallback]
        | undefined;
      assert.ok(work, "실행할 cancelled idle callback이 없습니다.");
      const [handle, callback] = work;
      cancelledIdleWork.delete(handle);
      await act(async () => {
        callback({
          didTimeout,
          timeRemaining: () => timeRemainingMs,
        });
      });
    },
    unmount,
    getResult: (index = 0) => {
      const result = currentResults[index];
      assert.ok(result, `hook ${index} render 결과가 없습니다.`);
      return result;
    },
  };
}

function listRecoveryKeys(storage: Storage, sourceKey: string): string[] {
  const prefix = createFormDraftRecoveryPrefix(sourceKey);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function readDraft(storage: Storage, storageKey: string): DraftData | null {
  const raw = storage.getItem(storageKey);
  return raw ? parseFormDraft<DraftData>(raw)?.data ?? null : null;
}

type StorageWrite = { key: string; value: string };

function trackStorageWrites(storage: Storage): {
  restore: () => void;
  writes: StorageWrite[];
} {
  const writes: StorageWrite[] = [];
  const ownDescriptor = Object.getOwnPropertyDescriptor(storage, "setItem");
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: (key: string, value: string) => {
      writes.push({ key, value });
      originalSetItem(key, value);
    },
  });

  return {
    writes,
    restore: () => {
      if (ownDescriptor) {
        Object.defineProperty(storage, "setItem", ownDescriptor);
      } else {
        Reflect.deleteProperty(storage, "setItem");
      }
    },
  };
}

function lazyDraft(title: string, onRead: () => void): DraftData {
  return {
    title,
    get contentHtml() {
      onRead();
      return `<p>${title}</p>`;
    },
  };
}

async function tickTimers(context: TestContext, milliseconds: number): Promise<void> {
  await act(async () => {
    context.mock.timers.tick(milliseconds);
  });
}

function blockFormDraftStorage(storage: Storage): {
  restore: () => void;
  setItem: (key: string, value: string) => void;
} {
  const methodNames = ["getItem", "setItem", "removeItem"] as const;
  const originalMethods = {
    getItem: storage.getItem.bind(storage),
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
  };
  const denyAccess = () => {
    const error = new Error("localStorage access denied");
    error.name = "SecurityError";
    throw error;
  };

  for (const name of methodNames) {
    Object.defineProperty(storage, name, {
      configurable: true,
      value: denyAccess,
    });
  }

  return {
    setItem: originalMethods.setItem,
    restore: () => {
      for (const name of methodNames) {
        Object.defineProperty(storage, name, {
          configurable: true,
          value: originalMethods[name],
        });
      }
    },
  };
}

test("localStorage accessor 자체가 차단돼도 mount와 flush는 예외 없이 error 상태로 수렴한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-storage-accessor-blocked",
  );
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    undefined,
    1,
    { blockLocalStorageAccessor: true },
  );

  assert.equal(harness.getResult().loaded, true);
  assert.equal(harness.getResult().status, "error");
  assert.equal(harness.resetCounts[0], 1);

  await act(async () => {
    assert.equal(harness.getResult().flush(), false);
  });
  await harness.unmount();
});

test("unmount 시 debounce 대기 중인 draft를 즉시 flush한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-unmount");
  const harness = await createDraftHookHarness(context, draftKey);
  const pendingDraft = draft("unmount 직전 입력");

  await act(async () => {
    harness.getResult().save(pendingDraft);
  });
  assert.equal(harness.browserWindow.localStorage.getItem(draftKey), null);

  await harness.unmount();

  assert.deepEqual(
    readDraft(harness.browserWindow.localStorage, draftKey),
    pendingDraft,
  );
});

test("연속 save가 trailing debounce를 밀어도 첫 pending의 max wait에서 최신 1건만 저장한다", { concurrency: false }, async (context) => {
  assert.equal(FORM_DRAFT_MAX_WAIT_MS, 5_000);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-max-wait-checkpoint",
  );
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    undefined,
    1,
    { debounceMs: 100, maxWaitMs: 250 },
  );
  const storage = harness.browserWindow.localStorage;
  const tracker = trackStorageWrites(storage);
  const getterReads = [0, 0, 0];

  try {
    await act(async () => {
      harness.getResult().save(lazyDraft("첫 입력", () => { getterReads[0] += 1; }));
    });
    await tickTimers(context, 80);
    await act(async () => {
      harness.getResult().save(lazyDraft("중간 입력", () => { getterReads[1] += 1; }));
    });
    await tickTimers(context, 80);
    await act(async () => {
      harness.getResult().save(lazyDraft("최신 입력", () => { getterReads[2] += 1; }));
    });
    await tickTimers(context, 89);

    assert.equal(storage.getItem(draftKey), null);
    assert.deepEqual(getterReads, [0, 0, 0]);
    assert.equal(tracker.writes.length, 0);

    await tickTimers(context, 1);

    assert.deepEqual(readDraft(storage, draftKey), draft("최신 입력"));
    assert.deepEqual(
      getterReads,
      [0, 0, 2],
      "최신 getter는 signature와 envelope 직렬화에서 한 번씩만 읽어야 합니다.",
    );
    assert.equal(
      tracker.writes.filter(({ key }) => key === draftKey).length,
      1,
    );
    assert.equal(
      tracker.writes.filter((write: StorageWrite) =>
        write.key.startsWith(createFormDraftRecoveryPrefix(draftKey))).length,
      1,
    );
    assert.equal(tracker.writes.length, 2);

    await tickTimers(context, 500);
    assert.deepEqual(getterReads, [0, 0, 2]);
    assert.equal(tracker.writes.length, 2);
  } finally {
    tracker.restore();
  }
});

test("일반 debounce flush는 남은 max wait timer를 취소한다", { concurrency: false }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-debounce-cancels-max-wait",
  );
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    undefined,
    1,
    { debounceMs: 40, maxWaitMs: 200 },
  );
  const storage = harness.browserWindow.localStorage;
  const tracker = trackStorageWrites(storage);
  let getterReads = 0;

  try {
    await act(async () => {
      harness.getResult().save(lazyDraft("debounce 저장", () => { getterReads += 1; }));
    });
    await tickTimers(context, 39);
    assert.equal(storage.getItem(draftKey), null);

    await tickTimers(context, 1);
    assert.deepEqual(readDraft(storage, draftKey), draft("debounce 저장"));
    assert.equal(getterReads, 2);
    assert.equal(tracker.writes.length, 2);

    await tickTimers(context, 500);
    assert.equal(getterReads, 2);
    assert.equal(tracker.writes.length, 2);
  } finally {
    tracker.restore();
  }
});

test("수동 flush는 debounce와 max wait의 늦은 재실행을 모두 막는다", { concurrency: false }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-manual-flush-cancels-max-wait",
  );
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    undefined,
    1,
    { debounceMs: 100, maxWaitMs: 200 },
  );
  const storage = harness.browserWindow.localStorage;
  const tracker = trackStorageWrites(storage);
  let getterReads = 0;

  try {
    let flushed = false;
    await act(async () => {
      harness.getResult().save(lazyDraft("수동 저장", () => { getterReads += 1; }));
      flushed = harness.getResult().flush();
    });

    assert.equal(flushed, true);
    assert.deepEqual(readDraft(storage, draftKey), draft("수동 저장"));
    assert.equal(getterReads, 2);
    assert.equal(tracker.writes.length, 2);

    await tickTimers(context, 500);
    assert.equal(getterReads, 2);
    assert.equal(tracker.writes.length, 2);
  } finally {
    tracker.restore();
  }
});

test("clear·key 변경·unmount는 두 flush timer를 정리하고 늦은 중복 쓰기를 만들지 않는다", { concurrency: false }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const firstKey = createDocumentDraftKey("note", "student-1", "timer-key-a");
  const secondKey = createDocumentDraftKey("note", "student-1", "timer-key-b");
  const thirdKey = createDocumentDraftKey("note", "student-1", "timer-key-c");
  const harness = await createDraftHookHarness(
    context,
    firstKey,
    undefined,
    1,
    { debounceMs: 100, maxWaitMs: 250 },
  );
  const storage = harness.browserWindow.localStorage;
  const tracker = trackStorageWrites(storage);
  const getterReads = [0, 0, 0];

  try {
    await act(async () => {
      harness.getResult().save(lazyDraft("key 변경 전", () => { getterReads[0] += 1; }));
    });
    await harness.render(secondKey);
    assert.deepEqual(readDraft(storage, firstKey), draft("key 변경 전"));
    assert.equal(getterReads[0], 2);
    const writesAfterKeyChange = tracker.writes.length;
    await tickTimers(context, 500);
    assert.equal(tracker.writes.length, writesAfterKeyChange);
    assert.equal(getterReads[0], 2);

    await act(async () => {
      harness.getResult().save(lazyDraft("clear 대상", () => { getterReads[1] += 1; }));
      harness.getResult().clear();
    });
    await tickTimers(context, 500);
    assert.equal(storage.getItem(secondKey), null);
    assert.equal(getterReads[1], 0);
    assert.equal(tracker.writes.length, writesAfterKeyChange);

    await harness.render(thirdKey);
    await act(async () => {
      harness.getResult().save(lazyDraft("unmount 직전", () => { getterReads[2] += 1; }));
    });
    await harness.unmount();
    assert.deepEqual(readDraft(storage, thirdKey), draft("unmount 직전"));
    assert.equal(getterReads[2], 2);
    const writesAfterUnmount = tracker.writes.length;
    await tickTimers(context, 500);
    assert.equal(tracker.writes.length, writesAfterUnmount);
    assert.deepEqual(getterReads, [2, 0, 2]);
  } finally {
    tracker.restore();
  }
});

test("지연 에디터 bridge는 입력 경로에서 본문을 읽지 않고 flush 경계에서 최신값을 반환한다", { concurrency: false }, async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  const restoreBrowserGlobals = installBrowserGlobals(browserWindow);
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  type DeferredEditorResult = ReturnType<typeof useDeferredEditorContent>;
  let currentResult: DeferredEditorResult | null = null;

  const getResult = (): DeferredEditorResult => {
    if (!currentResult) throw new Error("deferred editor hook 결과가 없습니다.");
    return currentResult;
  };

  function Probe() {
    currentResult = useDeferredEditorContent("<p>초기</p>");
    return null;
  }

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    restoreBrowserGlobals();
  });
  await act(async () => root.render(<Probe />));
  assert.ok(getResult());

  let contentReads = 0;
  const readEditor = () => {
    contentReads += 1;
    return "<p>마지막 입력</p>";
  };
  await act(async () => getResult().handleEditorDirty(readEditor));
  assert.equal(contentReads, 0);
  assert.equal(getResult().contentHtml, "<p>초기</p>");

  let latestHtml = "";
  await act(async () => {
    latestHtml = getResult().readLatestContentHtml();
  });
  assert.equal(latestHtml, "<p>마지막 입력</p>");
  assert.equal(contentReads, 1);
  assert.equal(
    getResult().contentHtml,
    "<p>초기</p>",
    "draft flush용 read는 React 표시 상태를 변경하지 않아야 합니다.",
  );

  await act(async () => {
    latestHtml = getResult().commitLatestContentHtml();
  });
  assert.equal(latestHtml, "<p>마지막 입력</p>");
  assert.equal(contentReads, 2);
  assert.equal(getResult().contentHtml, "<p>마지막 입력</p>");

  await act(async () => getResult().setContentHtml("<p>서버 복원</p>"));
  assert.equal(getResult().readLatestContentHtml(), "<p>서버 복원</p>");
  assert.equal(contentReads, 2, "명시적 복원 뒤에는 이전 editor reader를 다시 사용하지 않아야 합니다.");

  const restoredVersion = getResult().contentVersion;
  await act(async () => getResult().handleEditorDirty(() => "<p>아직 publish되지 않은 입력</p>"));
  await act(async () => getResult().setContentHtml("<p>서버 복원</p>"));
  assert.equal(
    getResult().contentVersion,
    restoredVersion + 1,
    "같은 HTML을 다시 복원해도 editor 동기화를 위한 version이 증가해야 합니다.",
  );
  assert.equal(getResult().readLatestContentHtml(), "<p>서버 복원</p>");
});

test("editor publish 전 메타 필드가 바뀌어도 최신 본문 pending을 빈 draft로 지우지 않는다", { concurrency: false }, async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  const restoreBrowserGlobals = installBrowserGlobals(browserWindow);
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  const draftKey = createDocumentDraftKey("community-post", "student-1", "unpublished-meta-change");
  type MetadataDraft = { category: string; contentHtml: string };
  type Controls = {
    flush: () => boolean;
    markEditorDirty: (reader: () => string) => void;
    setCategory: (category: string) => void;
  };
  let controls: Controls | null = null;

  const getControls = (): Controls => {
    if (!controls) throw new Error("metadata draft probe가 준비되지 않았습니다.");
    return controls;
  };

  function Probe() {
    const [category, setCategory] = React.useState("general");
    const {
      contentHtml,
      handleEditorDirty,
      readLatestContentHtml,
    } = useDeferredEditorContent("");
    const { loaded, save, clear, flush } = useFormDraft<MetadataDraft>(
      draftKey,
      () => undefined,
      { debounceMs: 60_000 },
    );

    React.useEffect(() => {
      if (!loaded) return;
      const latestContentHtml = readLatestContentHtml();
      if (isRichTextEmpty(latestContentHtml)) {
        clear();
        return;
      }
      save({
        category,
        get contentHtml() {
          return readLatestContentHtml();
        },
      });
    }, [category, clear, contentHtml, loaded, readLatestContentHtml, save]);

    controls = {
      flush,
      setCategory,
      markEditorDirty: (reader) => {
        handleEditorDirty(reader);
        save({
          category,
          get contentHtml() {
            return reader();
          },
        });
      },
    };
    return null;
  }

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    restoreBrowserGlobals();
  });
  await act(async () => root.render(<Probe />));

  await act(async () => {
    getControls().markEditorDirty(() => "<p>publish 전 마지막 입력</p>");
  });
  await act(async () => getControls().setCategory("feedback"));
  await act(async () => {
    assert.equal(getControls().flush(), true);
  });

  const stored = browserWindow.localStorage.getItem(draftKey);
  assert.ok(stored);
  assert.deepEqual(parseFormDraft<MetadataDraft>(stored)?.data, {
    category: "feedback",
    contentHtml: "<p>publish 전 마지막 입력</p>",
  });
});

test("연속 입력은 전체 draft 직렬화와 signature 계산을 flush 경계까지 지연한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-input-burst");
  const harness = await createDraftHookHarness(context, draftKey);
  const contentReads = Array.from({ length: 20 }, () => 0);
  const drafts = contentReads.map((_, index): DraftData => ({
    title: `연속 입력 ${index}`,
    get contentHtml() {
      contentReads[index] += 1;
      return `<p>${"가".repeat(50_000)} ${index}</p>`;
    },
  }));

  await act(async () => {
    for (const pendingDraft of drafts) harness.getResult().save(pendingDraft);
  });

  assert.equal(
    contentReads.reduce((total, count) => total + count, 0),
    0,
    "debounce 전 입력 경로에서는 전체 문서 값을 순회하지 않아야 합니다.",
  );
  assert.equal(harness.browserWindow.localStorage.getItem(draftKey), null);

  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });

  assert.equal(
    contentReads.slice(0, -1).reduce((total, count) => total + count, 0),
    0,
    "덮어쓴 중간 입력은 직렬화하지 않아야 합니다.",
  );
  assert.ok(contentReads.at(-1)! > 0);
  assert.deepEqual(readDraft(harness.browserWindow.localStorage, draftKey), {
    title: "연속 입력 19",
    contentHtml: `<p>${"가".repeat(50_000)} 19</p>`,
  });
});

test("생성 operation ID를 본문과 함께 저장하고 remount에서 그대로 복원한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const harness = await createDraftHookHarness(context, draftKey);
  const pendingDraft: DraftData = {
    operationId: "c00e5ee7-36ae-45eb-a39a-d96f6292a842",
    title: "재전송 가능한 초안",
    contentHtml: "<p>마지막 입력</p>",
  };

  await act(async () => {
    harness.getResult().save(pendingDraft);
    harness.getResult().flush();
  });
  await harness.remount(draftKey);

  assert.deepEqual(harness.restoredDrafts.at(-1), pendingDraft);
});

test("생성 충돌을 별도 문서로 분리할 때 본문은 유지하고 operation ID만 회전한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1");
  const harness = await createDraftHookHarness(context, draftKey);
  const original: DraftData = {
    operationId: "c00e5ee7-36ae-45eb-a39a-d96f6292a842",
    title: "분리할 초안",
    contentHtml: "<p>보존할 본문</p>",
  };
  const separated: DraftData = {
    ...original,
    operationId: "00682a4f-122b-44d9-8606-28973e138cc4",
  };

  await act(async () => {
    harness.getResult().save(original);
    harness.getResult().flush();
    harness.getResult().save(separated);
    harness.getResult().flush();
  });

  assert.deepEqual(
    readDraft(harness.browserWindow.localStorage, draftKey),
    separated,
  );
  await act(async () => {
    harness.getResult().clear({
      reason: "submitted",
      submittedData: separated,
    });
  });
  assert.equal(harness.browserWindow.localStorage.getItem(draftKey), null);
});

test("구버전 hook은 미래 version canonical을 보존하고 새 입력을 recovery로 격리한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-future-version");
  const futureDraft = draft("미래 client 초안");
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now() - 1_000,
    data: futureDraft,
  });
  const currentDraft = draft("구버전 client 새 입력");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(futureDraft),
      Date.now(),
    );
    storage.setItem(draftKey, futureRaw);
  });
  const storage = harness.browserWindow.localStorage;

  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.deepEqual(harness.restoredDrafts, []);
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);

  await act(async () => {
    harness.getResult().save(currentDraft);
    harness.getResult().flush();
  });

  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);
  assert.deepEqual(
    listRecoveryKeys(storage, draftKey).map((storageKey) => readDraft(storage, storageKey)),
    [currentDraft],
  );

  const currentRecoveryKey = harness.getResult().recoveries[0]?.storageKey;
  assert.ok(currentRecoveryKey);
  await act(async () => {
    harness.getResult().discardRecovery(currentRecoveryKey);
  });
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "incompatible");

  const nextCurrentDraft = draft("구버전 client 다시 입력");
  await act(async () => {
    harness.getResult().save(nextCurrentDraft);
    harness.getResult().flush();
  });
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "incompatible");
  assert.deepEqual(
    listRecoveryKeys(storage, draftKey).map((storageKey) => readDraft(storage, storageKey)),
    [nextCurrentDraft],
  );

  await act(async () => {
    harness.getResult().clear({ reason: "discard" });
  });
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);
});

test("미래 version canonical 잠금은 recovery quota 오류 뒤에도 제출을 막는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-future-quota-lock",
  );
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("미래 canonical"),
  });
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, futureRaw);
  });
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });
  try {
    await act(async () => {
      harness.getResult().save(draft("quota 중 구버전 입력"));
      assert.equal(harness.getResult().flush(), false);
    });
  } finally {
    Object.defineProperty(storage, "setItem", {
      configurable: true,
      value: originalSetItem,
    });
  }

  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "error");
  assert.equal(harness.getResult().canSubmit, false);
});

test("미래 version canonical 잠금은 recovery 목록 refresh 오류 뒤에도 제출을 막는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-future-refresh-lock",
  );
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("미래 canonical"),
  });
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, futureRaw);
  });
  const { browserWindow } = harness;
  const storage = browserWindow.localStorage;
  const originalKey = storage.key.bind(storage);

  Object.defineProperty(storage, "key", {
    configurable: true,
    value: () => {
      const storageError = new Error("localStorage key enumeration failed");
      storageError.name = "SecurityError";
      throw storageError;
    },
  });
  try {
    await act(async () => {
      browserWindow.dispatchEvent(
        new browserWindow.StorageEvent("storage", {
          key: createFormDraftRecoveryKey(draftKey, "refresh-error"),
          storageArea: storage,
          url: browserWindow.location.href,
        }),
      );
    });
  } finally {
    Object.defineProperty(storage, "key", {
      configurable: true,
      value: originalKey,
    });
  }

  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "error");
  assert.equal(harness.getResult().canSubmit, false);
});

test("이미 확인한 미래 canonical은 같은 key remount의 storage read 오류에도 제출 잠금을 유지한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-future-remount-read-error",
  );
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("remount 전에 확인한 미래 canonical"),
  });
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, futureRaw);
  });
  const storage = harness.browserWindow.localStorage;
  const originalGetItem = storage.getItem.bind(storage);

  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);

  Object.defineProperty(storage, "getItem", {
    configurable: true,
    value: () => {
      const storageError = new Error("localStorage read blocked");
      storageError.name = "SecurityError";
      throw storageError;
    },
  });
  try {
    await harness.remount(draftKey);
    assert.equal(harness.getResult().loaded, true);
    assert.equal(harness.getResult().status, "error");
    assert.equal(harness.getResult().canSubmit, false);
  } finally {
    Object.defineProperty(storage, "getItem", {
      configurable: true,
      value: originalGetItem,
    });
  }

  assert.equal(originalGetItem(draftKey), futureRaw);
});

test("미래 canonical key의 잠금은 A-B-A 복귀 read 오류에서도 key별로 유지된다", { concurrency: false }, async (context) => {
  const futureKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-future-key-return",
  );
  const compatibleKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-compatible-key-between",
  );
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("돌아올 미래 canonical"),
  });
  const harness = await createDraftHookHarness(context, futureKey, (storage) => {
    storage.setItem(futureKey, futureRaw);
  });
  const storage = harness.browserWindow.localStorage;
  const originalGetItem = storage.getItem.bind(storage);

  assert.equal(harness.getResult().canSubmit, false);
  await harness.render(compatibleKey);
  assert.equal(harness.getResult().loaded, true);
  assert.equal(harness.getResult().status, "idle");
  assert.equal(harness.getResult().canSubmit, true);

  Object.defineProperty(storage, "getItem", {
    configurable: true,
    value: () => {
      const storageError = new Error("localStorage read blocked on key return");
      storageError.name = "SecurityError";
      throw storageError;
    },
  });
  try {
    await harness.render(futureKey);
    assert.equal(harness.getResult().loaded, true);
    assert.equal(harness.getResult().status, "error");
    assert.equal(harness.getResult().canSubmit, false);
  } finally {
    Object.defineProperty(storage, "getItem", {
      configurable: true,
      value: originalGetItem,
    });
  }

  assert.equal(originalGetItem(futureKey), futureRaw);
});

async function assertFutureCanonicalVisibleFallback(
  context: TestContext,
  options: {
    contextId: string;
    errorName: "QuotaExceededError" | "SecurityError";
    expectedInitialWriteAttempts: number;
  },
): Promise<void> {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    options.contextId,
  );
  const awayKey = createDocumentDraftKey(
    "note",
    "student-1",
    `${options.contextId}-away`,
  );
  const visibleDraft = draft("현재 화면 초안");
  const visibleRaw = serializeFormDraft(visibleDraft, Date.now() - 1_000);
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("미래 탭 초안"),
  });
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, visibleRaw);
  });
  const { browserWindow } = harness;
  const storage = browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  let blockedWriteAttempts = 0;

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      blockedWriteAttempts += 1;
      const storageError = new Error("localStorage write blocked");
      storageError.name = options.errorName;
      throw storageError;
    },
  });
  try {
    originalSetItem(draftKey, futureRaw);
    await act(async () => {
      browserWindow.dispatchEvent(
        new browserWindow.StorageEvent("storage", {
          key: draftKey,
          oldValue: visibleRaw,
          newValue: futureRaw,
          storageArea: storage,
          url: browserWindow.location.href,
        }),
      );
    });
    assert.equal(blockedWriteAttempts, options.expectedInitialWriteAttempts);
    assert.equal(storage.getItem(draftKey), futureRaw);
    assert.equal(harness.getResult().status, "error");
    assert.equal(harness.getResult().canSubmit, false);

    const blockedUnload = new browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    browserWindow.dispatchEvent(blockedUnload);
    assert.equal(blockedUnload.defaultPrevented, true);

    await harness.render(awayKey);
    assert.equal(storage.getItem(draftKey), futureRaw);
  } finally {
    Object.defineProperty(storage, "setItem", {
      configurable: true,
      value: originalSetItem,
    });
  }

  await harness.render(draftKey);
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.deepEqual(harness.restoredDrafts.at(-1), visibleDraft);
  assert.equal(harness.restoredDrafts.length, 2);
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);

  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === visibleDraft.title),
    true,
  );
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);
}

test("future canonical event의 visible snapshot SecurityError는 이탈을 경고하고 SPA 재진입에서 복원한다", { concurrency: false }, async (context) => {
  await assertFutureCanonicalVisibleFallback(context, {
    contextId: "note-future-storage-security-error",
    errorName: "SecurityError",
    expectedInitialWriteAttempts: 1,
  });
});

test("future canonical event의 visible snapshot quota 재시도 실패도 SPA 재진입에서 복원한다", { concurrency: false }, async (context) => {
  await assertFutureCanonicalVisibleFallback(context, {
    contextId: "note-future-storage-quota-error",
    errorName: "QuotaExceededError",
    expectedInitialWriteAttempts: 2,
  });
});

test("storage event로 미래 version canonical이 들어온 동안만 제출을 막는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-future-storage-event",
  );
  const visibleDraft = draft("현재 화면 초안");
  const visibleRaw = serializeFormDraft(visibleDraft, Date.now() - 1_000);
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("미래 탭 초안"),
  });
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, visibleRaw);
  });
  const { browserWindow } = harness;

  assert.equal(harness.getResult().canSubmit, true);
  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, futureRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: visibleRaw,
        newValue: futureRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(browserWindow.localStorage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);
  assert.equal(
    harness.getResult().recoveries.some(
      (recovery) => recovery.isCurrent && recovery.preview.title === visibleDraft.title,
    ),
    true,
  );
  const durableUnload = new browserWindow.Event("beforeunload", {
    cancelable: true,
  });
  browserWindow.dispatchEvent(durableUnload);
  assert.equal(durableUnload.defaultPrevented, false);

  await act(async () => {
    browserWindow.localStorage.removeItem(draftKey);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: futureRaw,
        newValue: undefined,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(harness.getResult().status, "conflict");
  assert.equal(harness.getResult().canSubmit, true);
});

test("제출 tombstone cutoff 이전 canonical은 mount에서 ghost로 복원하지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-crash-clear");
  const submittedDraft = draft("marker 뒤 남은 canonical");
  const submittedAt = Date.now() - 1_000;
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, serializeFormDraft(submittedDraft, submittedAt - 1_000));
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(submittedDraft),
      submittedAt,
    );
  });

  assert.equal(harness.browserWindow.localStorage.getItem(draftKey), null);
  assert.deepEqual(harness.restoredDrafts, []);
  assert.equal(harness.getResult().status, "idle");
});

test("제출 tombstone보다 새 canonical은 mount에서 정상 복원한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-after-submit");
  const repeatedDraft = draft("제출 뒤 다시 작성");
  const submittedAt = Date.now() - 2_000;
  const canonicalRaw = serializeFormDraft(repeatedDraft, submittedAt + 1_000);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(repeatedDraft),
      submittedAt,
    );
    storage.setItem(draftKey, canonicalRaw);
  });

  assert.equal(harness.browserWindow.localStorage.getItem(draftKey), canonicalRaw);
  assert.deepEqual(harness.restoredDrafts, [repeatedDraft]);
  assert.equal(harness.getResult().status, "saved");
});

test("mount에서 stale canonical 확인 중 교체된 최신 canonical을 다시 읽어 복원한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-mount-race");
  const staleDraft = draft("제출 전 오래된 내용");
  const latestDraft = draft("다른 탭 최신 내용");
  const staleAt = Date.now() - 10_000;
  const submittedAt = staleAt + 1_000;
  const latestRaw = serializeFormDraft(latestDraft, submittedAt + 1_000);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, serializeFormDraft(staleDraft, staleAt));
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(staleDraft),
      submittedAt,
    );

    const originalGetItem = storage.getItem.bind(storage);
    const originalSetItem = storage.setItem.bind(storage);
    let canonicalReads = 0;
    Object.defineProperty(storage, "getItem", {
      configurable: true,
      value: (storageKey: string) => {
        if (storageKey === draftKey) {
          canonicalReads += 1;
          if (canonicalReads === 2) {
            originalSetItem(draftKey, latestRaw);
            return latestRaw;
          }
        }
        return originalGetItem(storageKey);
      },
    });
  });

  assert.deepEqual(readDraft(harness.browserWindow.localStorage, draftKey), latestDraft);
  assert.deepEqual(harness.restoredDrafts, [latestDraft]);
  assert.equal(harness.getResult().status, "saved");
});

test("storage event로 재도입된 제출 전 canonical은 CAS 제거한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-reintroduced");
  const submittedDraft = draft("재도입된 제출 전 canonical");
  const submittedAt = Date.now() + 1_000;
  const staleRaw = serializeFormDraft(submittedDraft, submittedAt - 1_000);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(submittedDraft),
      submittedAt,
    );
  });
  const { browserWindow } = harness;

  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, staleRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        newValue: staleRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(browserWindow.localStorage.getItem(draftKey), null);
  assert.deepEqual(harness.restoredDrafts, []);
  assert.equal(harness.getResult().status, "idle");
});

test("외부 canonical storage event에서 현재 visible snapshot을 own shadow로 보존한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-conflict");
  const visibleDraft = draft("현재 화면 내용");
  const externalDraft = draft("다른 탭 내용");
  const visibleRaw = serializeFormDraft(visibleDraft, 1_800_000_000_000);
  const externalRaw = serializeFormDraft(externalDraft, 1_800_000_001_000);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, visibleRaw);
  });
  const { browserWindow } = harness;

  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, externalRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: visibleRaw,
        newValue: externalRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(harness.getResult().status, "conflict");
  assert.deepEqual(readDraft(browserWindow.localStorage, draftKey), externalDraft);
  assert.equal(harness.getResult().recoveries.length, 1);
  const ownShadowKey = harness.getResult().recoveries[0]!.storageKey;
  assert.deepEqual(readDraft(browserWindow.localStorage, ownShadowKey), visibleDraft);
});

test("제출 전 visible 시각을 보존해 marker 뒤에는 남은 최신 canonical을 채택한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-marker-origin");
  const submittedDraft = draft("제출된 탭 내용");
  const latestDraft = draft("다른 탭 최신 내용");
  const visibleAt = Date.now() - 10_000;
  const submittedAt = visibleAt + 5_000;
  const initialRaw = serializeFormDraft(submittedDraft, visibleAt);
  const latestRaw = serializeFormDraft(latestDraft, submittedAt + 1_000);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, initialRaw),
  );
  const { browserWindow } = harness;
  const marker = writeFormDraftClearMarker(
    browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(submittedDraft),
    submittedAt,
  );

  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, latestRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: initialRaw,
        newValue: latestRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  const preservedSubmitted = listRecoveryKeys(browserWindow.localStorage, draftKey)
    .map((storageKey) => {
      const raw = browserWindow.localStorage.getItem(storageKey);
      return raw ? parseFormDraft<DraftData>(raw) : null;
    })
    .find((stored) => stored?.data.title === submittedDraft.title);
  assert.equal(preservedSubmitted?.savedAt?.getTime(), visibleAt);
  assert.equal(harness.getResult().status, "conflict");

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: createFormDraftClearMarkerEntryKey(
          draftKey,
          marker.signature,
          marker.clearedAt.getTime(),
        ),
        newValue: marker.raw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.deepEqual(readDraft(browserWindow.localStorage, draftKey), latestDraft);
  assert.deepEqual(harness.restoredDrafts, [submittedDraft, latestDraft]);
  assert.equal(
    listRecoveryKeys(browserWindow.localStorage, draftKey)
      .map((storageKey) => readDraft(browserWindow.localStorage, storageKey))
      .some((storedDraft) => storedDraft?.title === submittedDraft.title),
    false,
  );
  assert.equal(harness.getResult().status, "saved");
});

test("submitted clear 뒤 남은 canonical도 tombstone 대상이면 복원하지 않고 reset한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-double-marker");
  const visibleDraft = draft("현재 탭 제출본");
  const remainingGhost = draft("다른 제출의 오래된 canonical");
  const baseTime = Date.now() - 10_000;
  const visibleRaw = serializeFormDraft(visibleDraft, baseTime);
  const remainingRaw = serializeFormDraft(remainingGhost, baseTime + 1_000);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, visibleRaw),
  );
  const storage = harness.browserWindow.localStorage;
  const visibleMarker = writeFormDraftClearMarker(
    storage,
    draftKey,
    createFormDraftDataSignature(visibleDraft),
    baseTime + 2_000,
  );
  writeFormDraftClearMarker(
    storage,
    draftKey,
    createFormDraftDataSignature(remainingGhost),
    baseTime + 3_000,
  );
  storage.setItem(draftKey, remainingRaw);
  const resetCount = harness.resetCounts[0];

  await act(async () => {
    harness.browserWindow.dispatchEvent(
      new harness.browserWindow.StorageEvent("storage", {
        key: createFormDraftClearMarkerEntryKey(
          draftKey,
          visibleMarker.signature,
          visibleMarker.clearedAt.getTime(),
        ),
        newValue: visibleMarker.raw,
        storageArea: storage,
        url: harness.browserWindow.location.href,
      }),
    );
  });

  assert.equal(storage.getItem(draftKey), null);
  assert.deepEqual(harness.restoredDrafts, [visibleDraft]);
  assert.equal(harness.resetCounts[0], resetCount + 1);
  assert.equal(harness.getResult().status, "idle");
});

test("일반 clear는 다른 작성 흐름의 동일 signature recovery를 삭제하지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-clear-isolation");
  const sharedDraft = draft("두 탭의 같은 입력");
  const externalDraft = draft("다른 canonical");
  const sharedRaw = serializeFormDraft(sharedDraft, Date.now() - 10_000);
  const externalRaw = serializeFormDraft(externalDraft, Date.now() - 5_000);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, sharedRaw),
    2,
  );
  const { browserWindow } = harness;

  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, externalRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: sharedRaw,
        newValue: externalRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(listRecoveryKeys(browserWindow.localStorage, draftKey).length, 2);
  await act(async () => {
    harness.getResult(0).clear();
  });

  const remainingRecoveryKeys = listRecoveryKeys(browserWindow.localStorage, draftKey);
  assert.equal(remainingRecoveryKeys.length, 1);
  assert.deepEqual(
    readDraft(browserWindow.localStorage, remainingRecoveryKeys[0]!),
    sharedDraft,
  );
  assert.deepEqual(readDraft(browserWindow.localStorage, draftKey), externalDraft);
  assert.equal(harness.getResult(1).status, "conflict");
});

test("이전 recovery 삭제 뒤 debounce 중인 새 입력은 새 불변 shadow에 보존한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-discard-pending");
  const visibleDraft = draft("충돌 전 화면 내용");
  const externalDraft = draft("다른 탭 canonical");
  const pendingDraft = draft("삭제 직전 새 입력");
  const visibleRaw = serializeFormDraft(visibleDraft, 1_800_000_000_000);
  const externalRaw = serializeFormDraft(externalDraft, 1_800_000_001_000);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, visibleRaw);
  });
  const { browserWindow } = harness;

  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, externalRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: visibleRaw,
        newValue: externalRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  const ownShadowKey = harness.getResult().recoveries[0]?.storageKey;
  assert.ok(ownShadowKey);

  await act(async () => {
    harness.getResult().save(pendingDraft);
    harness.getResult().discardRecovery(ownShadowKey);
    harness.getResult().flush();
  });

  assert.deepEqual(readDraft(browserWindow.localStorage, draftKey), externalDraft);
  assert.equal(browserWindow.localStorage.getItem(ownShadowKey), null);
  assert.equal(
    listRecoveryKeys(browserWindow.localStorage, draftKey)
      .map((storageKey) => readDraft(browserWindow.localStorage, storageKey))
      .some((storedDraft) => storedDraft?.title === pendingDraft.title),
    true,
  );
  assert.equal(harness.getResult().status, "conflict");
  assert.deepEqual(harness.restoredDrafts, [visibleDraft]);
});

test("key switch는 이전 문서 pending을 이전 key에 flush하고 새 문서에 섞지 않는다", { concurrency: false }, async (context) => {
  const firstKey = createDocumentDraftKey("note", "student-1", "note-first");
  const secondKey = createDocumentDraftKey("note", "student-1", "note-second");
  const firstDraft = draft("첫 문서 pending");
  const secondDraft = draft("둘째 문서 입력");
  const harness = await createDraftHookHarness(context, firstKey);

  await act(async () => {
    harness.getResult().save(firstDraft);
  });
  await harness.render(secondKey);

  assert.deepEqual(readDraft(harness.browserWindow.localStorage, firstKey), firstDraft);
  assert.equal(harness.browserWindow.localStorage.getItem(secondKey), null);

  await act(async () => {
    harness.getResult().save(secondDraft);
    harness.getResult().flush();
  });

  assert.deepEqual(readDraft(harness.browserWindow.localStorage, firstKey), firstDraft);
  assert.deepEqual(readDraft(harness.browserWindow.localStorage, secondKey), secondDraft);
});

test("quota hard fail로 flush하지 못한 pending은 SPA key 전환 뒤 메모리 fallback에서 복원한다", { concurrency: false }, async (context) => {
  const firstKey = createDocumentDraftKey("note", "student-1", "note-quota-first");
  const secondKey = createDocumentDraftKey("note", "student-1", "note-quota-second");
  const pendingDraft = draft("quota 중에도 잃지 않을 입력");
  const harness = await createDraftHookHarness(context, firstKey);
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });

  await act(async () => {
    harness.getResult().save(pendingDraft);
  });
  await harness.render(secondKey);
  assert.equal(storage.getItem(firstKey), null);

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await harness.render(firstKey);
  assert.deepEqual(harness.restoredDrafts.at(-1), pendingDraft);
  assert.equal(harness.getResult().status, "error");

  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });
  assert.deepEqual(readDraft(storage, firstKey), pendingDraft);
  assert.equal(harness.getResult().status, "saved");
});

test("storage read까지 차단돼도 새 hook 인스턴스가 orphan volatile draft를 복원한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-security-error");
  const pendingDraft = draft("저장소 접근 차단 중 유일본");
  const harness = await createDraftHookHarness(context, draftKey);
  const storage = harness.browserWindow.localStorage;
  const originalGetItem = storage.getItem.bind(storage);
  const originalSetItem = storage.setItem.bind(storage);

  await act(async () => {
    harness.getResult().save(pendingDraft);
  });
  Object.defineProperties(storage, {
    getItem: {
      configurable: true,
      value: () => {
        const securityError = new Error("localStorage access denied");
        securityError.name = "SecurityError";
        throw securityError;
      },
    },
    setItem: {
      configurable: true,
      value: () => {
        const securityError = new Error("localStorage access denied");
        securityError.name = "SecurityError";
        throw securityError;
      },
    },
  });

  await harness.remount(draftKey);
  assert.deepEqual(harness.restoredDrafts.at(-1), pendingDraft);
  assert.equal(harness.getResult().status, "error");
  assert.equal(harness.getResult().canSubmit, true);

  Object.defineProperties(storage, {
    getItem: { configurable: true, value: originalGetItem },
    setItem: { configurable: true, value: originalSetItem },
  });
  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });
  assert.deepEqual(readDraft(storage, draftKey), pendingDraft);
});

test("여러 writer의 orphan volatile draft를 최신본과 durable recovery로 모두 승격한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-multi-orphan");
  const firstDraft = draft("첫 writer 유일본");
  const latestDraft = draft("둘째 writer 최신 유일본");
  const harness = await createDraftHookHarness(context, draftKey, undefined, 2);
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });

  await act(async () => {
    harness.getResult(0).save(firstDraft);
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await act(async () => {
    harness.getResult(1).save(latestDraft);
  });
  await harness.remount(draftKey, 0);

  const orphanUnload = new harness.browserWindow.Event("beforeunload", {
    cancelable: true,
  });
  harness.browserWindow.dispatchEvent(orphanUnload);
  assert.equal(orphanUnload.defaultPrevented, true);

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await harness.remount(draftKey, 1);

  assert.deepEqual(harness.restoredDrafts.at(-1), latestDraft);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === firstDraft.title),
    true,
  );

  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });
  assert.deepEqual(readDraft(storage, draftKey), latestDraft);

  const persistedUnload = new harness.browserWindow.Event("beforeunload", {
    cancelable: true,
  });
  harness.browserWindow.dispatchEvent(persistedUnload);
  assert.equal(persistedUnload.defaultPrevented, false);
});

test("같은 writer의 key 복귀 중 승격 실패해도 기존 orphan을 보존하고 성공 flush에서 승격한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-writer-return");
  const firstAwayKey = createDocumentDraftKey("note", "student-1", "note-writer-away-a");
  const secondAwayKey = createDocumentDraftKey("note", "student-1", "note-writer-away-b");
  const olderDraft = draft("같은 writer 슬롯의 이전 유일본");
  const latestDraft = draft("다른 writer의 최신 유일본");
  const harness = await createDraftHookHarness(context, draftKey, undefined, 2);
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });

  await act(async () => {
    harness.getResult(0).save(olderDraft);
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await act(async () => {
    harness.getResult(1).save(latestDraft);
  });
  await harness.renderKeys([firstAwayKey, draftKey]);
  await harness.renderKeys([firstAwayKey, secondAwayKey]);
  await harness.renderKeys([draftKey, secondAwayKey]);

  assert.deepEqual(harness.restoredDrafts.at(-1), latestDraft);
  assert.equal(harness.getResult(0).status, "error");

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await act(async () => {
    assert.equal(harness.getResult(0).flush(), true);
  });

  assert.deepEqual(readDraft(storage, draftKey), latestDraft);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === olderDraft.title),
    true,
  );
  const persistedUnload = new harness.browserWindow.Event("beforeunload", {
    cancelable: true,
  });
  harness.browserWindow.dispatchEvent(persistedUnload);
  assert.equal(persistedUnload.defaultPrevented, false);
});

test("pending이 없어도 pagehide는 저장소 회복 뒤 남은 orphan을 승격한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-no-pending-sweep");
  const awayKey = createDocumentDraftKey("note", "student-1", "note-no-pending-away");
  const orphanDraft = draft("canonical보다 오래된 메모리 유일본");
  const canonicalDraft = draft("더 최신인 canonical");
  const harness = await createDraftHookHarness(context, draftKey);
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });

  await act(async () => {
    harness.getResult().save(orphanDraft);
  });
  await harness.render(awayKey);
  originalSetItem(
    draftKey,
    serializeFormDraft(canonicalDraft, Date.now() + 1_000),
  );
  await harness.render(draftKey);

  assert.deepEqual(harness.restoredDrafts.at(-1), canonicalDraft);
  assert.equal(harness.getResult().status, "saved");

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await act(async () => {
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("pagehide"));
  });

  assert.deepEqual(readDraft(storage, draftKey), canonicalDraft);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === orphanDraft.title),
    true,
  );
});

test("older orphan 승격 실패 뒤에도 최신 canonical을 과거 orphan으로 되감지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-orphan-order");
  const olderDraft = draft("승격 실패한 과거 orphan");
  const latestDraft = draft("먼저 복구된 최신 orphan");
  const harness = await createDraftHookHarness(context, draftKey, undefined, 2);
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });

  await act(async () => {
    harness.getResult(0).save(olderDraft);
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await act(async () => {
    harness.getResult(1).save(latestDraft);
  });
  await harness.remount(draftKey, 0);
  await harness.remount(draftKey, 1);
  assert.deepEqual(harness.restoredDrafts.at(-1), latestDraft);

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });
  assert.deepEqual(readDraft(storage, draftKey), latestDraft);

  await harness.remount(draftKey, 0);
  await harness.remount(draftKey, 1);

  assert.deepEqual(harness.restoredDrafts.at(-1), latestDraft);
  assert.deepEqual(readDraft(storage, draftKey), latestDraft);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === olderDraft.title),
    true,
  );
});

test("30일 넘게 메모리에 머문 orphan도 durable write 시점부터 보존 기간을 다시 센다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-aged-orphan");
  const agedDraft = draft("장기 실행 탭의 오래된 pending");
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("미래 canonical"),
  });
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, futureRaw);
  });
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });

  const originalNow = Date.now;
  Object.defineProperty(Date, "now", {
    configurable: true,
    value: () => originalNow() - FORM_DRAFT_RECOVERY_TTL_MS - 1_000,
  });
  try {
    await act(async () => {
      harness.getResult().save(agedDraft);
    });
  } finally {
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: originalNow,
    });
  }

  await harness.remount(draftKey, 0);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await harness.remount(draftKey, 1);
  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });

  assert.equal(storage.getItem(draftKey), futureRaw);
  const recoveryRaw = listRecoveryKeys(storage, draftKey)
    .map((storageKey) => storage.getItem(storageKey))
    .find((raw) => raw && parseFormDraft<DraftData>(raw)?.data.title === agedDraft.title);
  assert.ok(recoveryRaw);
  const storedRecovery = parseFormDraft<DraftData>(recoveryRaw);
  assert.ok(storedRecovery?.retainedAt);
  assert.ok(storedRecovery.retainedAt.getTime() > storedRecovery.savedAt!.getTime());
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);
});

test("recovery restore는 displaced canonical과 선택 recovery를 모두 보존한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("qna-reply", "student-1", "thread-restore");
  const canonicalDraft = draft("기존 canonical");
  const selectedDraft = draft("선택 recovery");
  const canonicalRaw = serializeFormDraft(canonicalDraft, 1_800_000_000_000);
  const selectedRaw = serializeFormDraft(selectedDraft, 1_800_000_001_000);
  const selectedKey = createFormDraftRecoveryKey(draftKey, "selected-tab");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, canonicalRaw);
    storage.setItem(selectedKey, selectedRaw);
  });

  assert.equal(harness.getResult().recoveries[0]?.storageKey, selectedKey);
  assert.deepEqual(harness.getResult().recoveries[0]?.preview, {
    title: "선택 recovery",
    body: "선택 recovery",
  });
  assert.equal(harness.getResult().recoveries[0]?.isCurrent, false);
  await act(async () => {
    harness.getResult().restoreRecovery(selectedKey);
  });

  const storage = harness.browserWindow.localStorage;
  assert.deepEqual(readDraft(storage, draftKey), selectedDraft);
  assert.equal(harness.getResult().savedAt?.getTime(), 1_800_000_001_000);
  assert.equal(storage.getItem(selectedKey), selectedRaw);
  assert.deepEqual(harness.restoredDrafts, [canonicalDraft, selectedDraft]);

  const recoveryDrafts = listRecoveryKeys(storage, draftKey)
    .map((storageKey) => readDraft(storage, storageKey))
    .filter((storedDraft): storedDraft is DraftData => storedDraft !== null);
  assert.equal(
    recoveryDrafts.some((storedDraft) => storedDraft.title === canonicalDraft.title),
    true,
  );
  assert.equal(
    recoveryDrafts.some((storedDraft) => storedDraft.title === selectedDraft.title),
    true,
  );
});

test("recovery restore는 미래 version canonical을 덮지 않고 선택본을 conflict recovery로 둔다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-future-restore");
  const futureRaw = JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: draft("미래 canonical"),
  });
  const selectedDraft = draft("구버전 recovery 선택본");
  const selectedKey = createFormDraftRecoveryKey(draftKey, "selected-v1");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, futureRaw);
    storage.setItem(selectedKey, serializeFormDraft(selectedDraft, Date.now()));
  });

  await act(async () => {
    harness.getResult().restoreRecovery(selectedKey);
  });

  const storage = harness.browserWindow.localStorage;
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "incompatible");
  assert.equal(harness.getResult().canSubmit, false);
  assert.deepEqual(harness.restoredDrafts, [selectedDraft]);
  assert.equal(
    harness.getResult().recoveries.some(
      (recovery) =>
        recovery.isCurrent && recovery.preview.title === selectedDraft.title,
    ),
    true,
  );
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === selectedDraft.title),
    true,
  );
});

test("목록을 본 뒤 제출 tombstone이 생긴 legacy recovery는 복원하지 않고 숨긴다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-stale-restore");
  const submittedDraft = draft("이미 제출된 복구본");
  const savedAt = Date.now() - 10_000;
  const selectedKey = createFormDraftRecoveryKey(draftKey, "stale-selected");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(selectedKey, serializeFormDraft(submittedDraft, savedAt));
  });
  assert.equal(harness.getResult().recoveries.length, 1);

  writeFormDraftClearMarker(
    harness.browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(submittedDraft),
    savedAt + 1_000,
  );
  await act(async () => {
    harness.getResult().restoreRecovery(selectedKey);
  });

  assert.deepEqual(harness.restoredDrafts, []);
  assert.notEqual(harness.browserWindow.localStorage.getItem(selectedKey), null);
  assert.equal(harness.browserWindow.localStorage.getItem(draftKey), null);
  assert.deepEqual(harness.getResult().recoveries, []);
  assert.equal(harness.getResult().status, "idle");
});

test("recovery persist 도중 제출 marker가 생기면 원래 savedAt 기준으로 복원을 취소한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-restore-post-marker");
  const submittedDraft = draft("복원 도중 제출된 과거 복구본");
  const savedAt = Date.now() - 10_000;
  const selectedKey = createFormDraftRecoveryKey(draftKey, "restore-post-marker");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(selectedKey, serializeFormDraft(submittedDraft, savedAt));
  });
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  let markerInjected = false;
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: (storageKey: string, raw: string) => {
      if (
        !markerInjected &&
        storageKey !== selectedKey &&
        storageKey.startsWith(createFormDraftRecoveryPrefix(draftKey))
      ) {
        markerInjected = true;
        writeFormDraftClearMarker(
          storage,
          draftKey,
          createFormDraftDataSignature(submittedDraft),
          savedAt + 1_000,
        );
      }
      originalSetItem(storageKey, raw);
    },
  });

  await act(async () => {
    harness.getResult().restoreRecovery(selectedKey);
  });

  assert.equal(markerInjected, true);
  assert.deepEqual(harness.restoredDrafts, []);
  assert.equal(storage.getItem(draftKey), null);
  assert.deepEqual(harness.getResult().recoveries, []);
  assert.equal(harness.getResult().status, "idle");
  assert.equal(harness.getResult().savedAt, null);
});

test("recovery 복원 중 발견한 tombstone 이전 canonical을 새 시각으로 되살리지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-restore-canonical-marker");
  const staleCanonical = draft("잠든 탭이 재도입한 제출본");
  const selectedDraft = draft("사용자가 선택한 안전한 복구본");
  const staleAt = Date.now() - 10_000;
  const selectedKey = createFormDraftRecoveryKey(draftKey, "safe-selected");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(selectedKey, serializeFormDraft(selectedDraft, staleAt + 2_000));
  });
  const storage = harness.browserWindow.localStorage;
  storage.setItem(draftKey, serializeFormDraft(staleCanonical, staleAt));
  writeFormDraftClearMarker(
    storage,
    draftKey,
    createFormDraftDataSignature(staleCanonical),
    staleAt + 1_000,
  );

  await act(async () => {
    harness.getResult().restoreRecovery(selectedKey);
  });

  assert.deepEqual(readDraft(storage, draftKey), selectedDraft);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === staleCanonical.title),
    false,
  );
  assert.deepEqual(harness.restoredDrafts, [selectedDraft]);
});

test("recovery 복원 전에 현재 탭 pending과 최신 canonical을 별도 복구본으로 보존한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-restore-pending");
  const initialDraft = draft("처음 canonical");
  const externalDraft = draft("다른 탭 최신 canonical");
  const selectedDraft = draft("선택 recovery");
  const pendingDraft = draft("현재 탭 미저장 입력");
  const initialRaw = serializeFormDraft(initialDraft, 1_800_000_000_000);
  const externalRaw = serializeFormDraft(externalDraft, 1_800_000_001_000);
  const selectedKey = createFormDraftRecoveryKey(draftKey, "selected-pending-tab");
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, initialRaw);
    storage.setItem(selectedKey, serializeFormDraft(selectedDraft, 1_800_000_002_000));
  });
  const { browserWindow } = harness;

  await act(async () => {
    browserWindow.localStorage.setItem(draftKey, externalRaw);
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: initialRaw,
        newValue: externalRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
    harness.getResult().save(pendingDraft);
  });

  await act(async () => {
    harness.getResult().restoreRecovery(selectedKey);
  });

  const storage = browserWindow.localStorage;
  assert.deepEqual(readDraft(storage, draftKey), selectedDraft);
  const recoveryDrafts = listRecoveryKeys(storage, draftKey)
    .map((storageKey) => readDraft(storage, storageKey))
    .filter((storedDraft): storedDraft is DraftData => storedDraft !== null);
  assert.equal(
    recoveryDrafts.some((storedDraft) => storedDraft.title === pendingDraft.title),
    true,
  );
  assert.equal(
    recoveryDrafts.some((storedDraft) => storedDraft.title === externalDraft.title),
    true,
  );
});

test("동일 signature를 제출한 hook은 다른 hook에서 ghost shadow를 재생성하지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-submitted");
  const submittedDraft = draft("제출 완료 내용");
  const submittedRaw = serializeFormDraft(submittedDraft, Date.now() - 10_000);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, submittedRaw),
    2,
  );
  const remoteResetCount = harness.resetCounts[1];

  await act(async () => {
    harness.getResult(0).clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
  });

  const storage = harness.browserWindow.localStorage;
  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(harness.getResult(1).status, "idle");
  assert.equal(harness.resetCounts[1], remoteResetCount + 1);
  assert.ok(readFormDraftClearMarker(storage, draftKey));

  await harness.unmount();

  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.notEqual(storage.getItem(createFormDraftClearMarkerKey(draftKey)), null);
});

test("compact 편집 제출은 stale legacy 원본을 마지막 head로 남기고 peer ghost를 막는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-compact-legacy-alias",
  );
  const userSnapshot = draft("compact와 legacy가 공유하는 사용자 내용");
  const currentLegacyDraft = {
    ...userSnapshot,
    base: {
      title: "현재 서버 기준 제목",
      noteDate: "2026-08-05",
      contentHtml: "<p>현재 서버 기준 본문</p>",
    },
  };
  const restoredLegacyDraft = {
    ...userSnapshot,
    base: {
      title: "복원 당시 이전 서버 제목",
      noteDate: "2026-07-31",
      contentHtml: "<p>복원 당시 이전 서버 본문</p>",
    },
  };
  const compactDraft = {
    ...userSnapshot,
    baseFingerprint: `sha256:${"a".repeat(64)}`,
    base: { title: "", noteDate: "", contentHtml: "" },
  };
  const recoveryKey = createFormDraftRecoveryKey(draftKey, "sleeping-legacy-peer");
  const restoredLegacyRaw = serializeFormDraft(
    restoredLegacyDraft,
    Date.now() - 10_000,
  );
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => {
      storage.setItem(draftKey, restoredLegacyRaw);
      storage.setItem(recoveryKey, restoredLegacyRaw);
    },
    2,
  );

  await act(async () => {
    harness.getResult(0).clear({
      reason: "submitted",
      submittedData: compactDraft,
      // 마지막 alias가 legacy head key에도 남아 head-only rolling client를 보호한다.
      submittedAliases: [userSnapshot, currentLegacyDraft, restoredLegacyDraft],
    });
  });

  const storage = harness.browserWindow.localStorage;
  const markerSignatures = new Set(
    readFormDraftClearMarkers(storage, draftKey).map(
      (marker) => marker.signature,
    ),
  );
  assert.equal(storage.getItem(draftKey), null);
  assert.equal(
    storage.getItem(recoveryKey),
    restoredLegacyRaw,
    "mutable rolling recovery는 tombstone으로 숨기되 CAS 경쟁을 위해 원문을 보존합니다.",
  );
  assert.equal(harness.getResult(0).recoveries.length, 0);
  assert.equal(harness.getResult(1).recoveries.length, 0);
  assert.equal(harness.getResult(1).status, "idle");
  assert.equal(
    markerSignatures.has(createFormDraftDataSignature(compactDraft)),
    true,
  );
  assert.equal(
    markerSignatures.has(createFormDraftDataSignature(currentLegacyDraft)),
    true,
  );
  assert.equal(
    markerSignatures.has(createFormDraftDataSignature(userSnapshot)),
    true,
  );
  assert.equal(
    markerSignatures.has(createFormDraftDataSignature(restoredLegacyDraft)),
    true,
  );
  assert.equal(
    readFormDraftClearMarker(storage, draftKey)?.signature,
    createFormDraftDataSignature(restoredLegacyDraft),
    "단일 head만 읽는 rolling client에도 exact stale legacy tombstone이 보여야 합니다.",
  );

  const restoredCountBeforeRemount = harness.restoredDrafts.length;
  await harness.remount(draftKey, 1);
  assert.equal(harness.getResult().status, "idle");
  assert.equal(harness.getResult().recoveries.length, 0);
  assert.equal(
    harness.restoredDrafts.length,
    restoredCountBeforeRemount,
    "marker가 가린 legacy recovery는 remount에서도 ghost로 복원하지 않아야 합니다.",
  );
});

test("multi-alias clear 전체 경로는 대형 recovery를 alias 수와 무관하게 한 번만 parse한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-multi-alias-single-pass",
  );
  const submittedRepresentations = [
    { ...draft("compact 표현"), representation: "compact" },
    { ...draft("legacy 표현"), representation: "legacy" },
    { ...draft("bare 표현"), representation: "bare" },
  ];
  const recoveryRaws = new Set<string>();
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => {
      for (let index = 0; index < 20; index += 1) {
        const data = submittedRepresentations[index % 3]!;
        const raw = serializeFormDraft(data, Date.now() - 10_000 - index);
        recoveryRaws.add(raw);
        storage.setItem(
          createImmutableFormDraftRecoveryKey(
            draftKey,
            `single-pass-${index}`,
            raw,
          ),
          raw,
        );
      }
    },
  );

  const parseDescriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
  const originalParse = JSON.parse;
  let recoveryParseCount = 0;
  Object.defineProperty(JSON, "parse", {
    configurable: true,
    value: (text: string) => {
      if (recoveryRaws.has(text)) recoveryParseCount += 1;
      return originalParse(text);
    },
  });

  try {
    await act(async () => {
      harness.getResult().clear({
        reason: "submitted",
        submittedData: submittedRepresentations[0],
        submittedAliases: submittedRepresentations.slice(1),
      });
    });
    assert.equal(recoveryParseCount, 20);
    assert.equal(listRecoveryKeys(harness.browserWindow.localStorage, draftKey).length, 0);
  } finally {
    if (parseDescriptor) Object.defineProperty(JSON, "parse", parseDescriptor);
  }
});

test("지연된 marker event는 현재 storage에서 marker가 사라져도 제출 전 snapshot을 정리한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-delayed-marker");
  const submittedDraft = draft("지연 이벤트 제출 내용");
  const submittedRaw = serializeFormDraft(submittedDraft, Date.now() - 10_000);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    storage.setItem(draftKey, submittedRaw);
  });
  const { browserWindow } = harness;
  const marker = writeFormDraftClearMarker(
    browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(submittedDraft),
  );
  removeFormDraftClearMarker(browserWindow.localStorage, draftKey);
  browserWindow.localStorage.removeItem(draftKey);

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: createFormDraftClearMarkerKey(draftKey),
        newValue: marker.raw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: submittedRaw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(listRecoveryKeys(browserWindow.localStorage, draftKey).length, 0);
  assert.equal(harness.getResult().status, "idle");
});

test("legacy head가 Y여도 지연된 X entry event는 제출 전 X pending을 정리한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-entry-event");
  const firstSubmittedDraft = draft("entry event 첫 제출");
  const secondSubmittedDraft = draft("entry event 둘째 제출");
  const harness = await createDraftHookHarness(context, draftKey);
  const { browserWindow } = harness;

  await act(async () => {
    harness.getResult().save(firstSubmittedDraft);
  });
  const firstMarker = writeFormDraftClearMarker(
    browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(firstSubmittedDraft),
    Date.now() + 1_000,
  );
  writeFormDraftClearMarker(
    browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(secondSubmittedDraft),
    firstMarker.clearedAt.getTime() + 1_000,
  );

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: createFormDraftClearMarkerEntryKey(
          draftKey,
          firstMarker.signature,
          firstMarker.clearedAt.getTime(),
        ),
        newValue: firstMarker.raw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.equal(listRecoveryKeys(browserWindow.localStorage, draftKey).length, 0);
  assert.equal(harness.getResult().status, "idle");
});

test("hook mount는 TTL이 지난 clear marker를 storage에서 물리 정리한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-expired-marker");
  const markerKey = createFormDraftClearMarkerKey(draftKey);
  const harness = await createDraftHookHarness(context, draftKey, (storage) => {
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(draft("만료 marker")),
      Date.now() - FORM_DRAFT_CLEAR_MARKER_TTL_MS - 1,
    );
  });

  assert.equal(harness.browserWindow.localStorage.getItem(markerKey), null);
});

test("recovery refresh는 항목마다 clear marker namespace를 다시 순회하지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "recovery-refresh-linear-scan",
  );
  const unrelatedEntryCount = 100;
  const recoveryCount = 20;
  let storageKeyCalls = 0;
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => {
      for (let index = 0; index < unrelatedEntryCount; index += 1) {
        storage.setItem(`unrelated:${index}`, `value:${index}`);
      }
      for (let index = 0; index < recoveryCount; index += 1) {
        const raw = serializeFormDraft(
          draft(`linear recovery ${index}`),
          Date.now() - index,
        );
        storage.setItem(
          createImmutableFormDraftRecoveryKey(draftKey, `linear-${index}`, raw),
          raw,
        );
      }

      const originalKey = storage.key.bind(storage);
      Object.defineProperty(storage, "key", {
        configurable: true,
        value: (index: number) => {
          storageKeyCalls += 1;
          return originalKey(index);
        },
      });
    },
    1,
    { deferArtifactSweepIdleWork: true },
  );

  assert.equal(harness.getResult().recoveries.length, recoveryCount);
  assert.ok(
    storageKeyCalls < (unrelatedEntryCount + recoveryCount) * 15,
    `recovery별 namespace 재순회 없이 선형 범위여야 합니다: ${storageKeyCalls}`,
  );
});

test("proactive sweep는 idle budget과 timeout fallback 모두 bounded slice로 나눠 실행한다", { concurrency: false }, async (context) => {
  const activeKey = createDocumentDraftKey(
    "note",
    "student-1",
    "idle-sweep-active",
  );
  const recoveryKeys: string[] = [];
  const expiredAt = Date.now() - FORM_DRAFT_RECOVERY_TTL_MS - 1;
  const harness = await createDraftHookHarness(
    context,
    activeKey,
    (storage) => {
      for (let index = 0; index < 6; index += 1) {
        const sourceKey = createDocumentDraftKey(
          "note",
          "student-1",
          `idle-sweep-inactive-${index}`,
        );
        const raw = serializeFormDraft(draft(`idle expired ${index}`), expiredAt);
        const recoveryKey = createImmutableFormDraftRecoveryKey(
          sourceKey,
          `idle-${index}`,
          raw,
        );
        recoveryKeys.push(recoveryKey);
        storage.setItem(recoveryKey, raw);
      }
    },
    1,
    { deferArtifactSweepIdleWork: true },
  );
  const storage = harness.browserWindow.localStorage;
  const countRemaining = () =>
    recoveryKeys.filter((recoveryKey) => storage.getItem(recoveryKey) !== null)
      .length;

  assert.equal(harness.pendingIdleWorkCount(), 1);
  assert.equal(countRemaining(), 6);

  await harness.runNextIdleWork({ didTimeout: false, timeRemainingMs: 0 });
  assert.equal(countRemaining(), 6);
  assert.equal(harness.pendingIdleWorkCount(), 1);

  await harness.runNextIdleWork({ didTimeout: true, timeRemainingMs: 0 });
  assert.equal(countRemaining(), 5, "timeout fallback은 한 key만 처리해야 합니다.");
  assert.equal(harness.pendingIdleWorkCount(), 1);

  await harness.runNextIdleWork({ didTimeout: false, timeRemainingMs: 100 });
  assert.equal(countRemaining(), 1, "idle slice는 최대 네 key만 처리해야 합니다.");
  assert.equal(harness.pendingIdleWorkCount(), 1);

  await harness.runNextIdleWork({ didTimeout: false, timeRemainingMs: 100 });
  assert.equal(countRemaining(), 0);
  assert.equal(harness.pendingIdleWorkCount(), 0);
});

test("마지막 hook unmount는 idle sweep를 취소하고 늦은 callback을 무효화한 뒤 remount에서 다시 예약한다", { concurrency: false }, async (context) => {
  const activeKey = createDocumentDraftKey(
    "note",
    "student-1",
    "idle-sweep-cancel-active",
  );
  const inactiveKey = createDocumentDraftKey(
    "note",
    "student-1",
    "idle-sweep-cancel-inactive",
  );
  const expiredAt = Date.now() - FORM_DRAFT_RECOVERY_TTL_MS - 1;
  let recoveryKey = "";
  let recoveryRaw = "";
  const harness = await createDraftHookHarness(
    context,
    activeKey,
    (storage) => {
      recoveryRaw = serializeFormDraft(draft("cancelled idle recovery"), expiredAt);
      recoveryKey = createImmutableFormDraftRecoveryKey(
        inactiveKey,
        "cancelled-idle",
        recoveryRaw,
      );
      storage.setItem(recoveryKey, recoveryRaw);
    },
    1,
    { deferArtifactSweepIdleWork: true },
  );
  const storage = harness.browserWindow.localStorage;

  assert.equal(harness.pendingIdleWorkCount(), 1);
  assert.equal(harness.cancelledIdleWorkCount(), 0);
  assert.equal(storage.getItem(recoveryKey), recoveryRaw);

  await harness.remount(activeKey);

  assert.equal(
    harness.cancelledIdleWorkCount(),
    1,
    "마지막 기존 hook의 예약 작업은 cancelIdleCallback으로 취소해야 합니다.",
  );
  assert.equal(
    harness.pendingIdleWorkCount(),
    1,
    "새 hook은 취소된 page-session sweep를 다시 예약해야 합니다.",
  );

  await harness.runNextCancelledIdleWork({ didTimeout: true, timeRemainingMs: 0 });

  assert.equal(
    storage.getItem(recoveryKey),
    recoveryRaw,
    "취소 뒤 늦게 전달된 callback은 storage를 변경하지 않아야 합니다.",
  );
  assert.equal(harness.pendingIdleWorkCount(), 1);

  await harness.runNextIdleWork({ didTimeout: true, timeRemainingMs: 0 });

  assert.equal(storage.getItem(recoveryKey), null);
  assert.equal(harness.pendingIdleWorkCount(), 0);
});

test("page-session sweep는 동시에 활성화된 A/B source를 보존하고 inactive artifact만 정리한다", { concurrency: false }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const activeKeyA = createDocumentDraftKey("note", "student-1", "active-a");
  const activeKeyB = createDocumentDraftKey("note", "student-1", "active-b");
  const inactiveKey = createDocumentDraftKey("note", "student-1", "inactive-c");
  const harness = await createDraftHookHarness(
    context,
    [activeKeyA, activeKeyB],
    undefined,
    2,
  );
  const storage = harness.browserWindow.localStorage;
  const expiredAt = Date.now() - FORM_DRAFT_RECOVERY_TTL_MS - 1;
  const rawA = serializeFormDraft(draft("active A recovery"), expiredAt);
  const rawB = serializeFormDraft(draft("active B recovery"), expiredAt);
  const rawC = serializeFormDraft(draft("inactive C recovery"), expiredAt);
  const recoveryKeyA = createImmutableFormDraftRecoveryKey(
    activeKeyA,
    "active-a",
    rawA,
  );
  const recoveryKeyB = createImmutableFormDraftRecoveryKey(
    activeKeyB,
    "active-b",
    rawB,
  );
  const recoveryKeyC = createImmutableFormDraftRecoveryKey(
    inactiveKey,
    "inactive-c",
    rawC,
  );
  storage.setItem(recoveryKeyA, rawA);
  storage.setItem(recoveryKeyB, rawB);
  storage.setItem(recoveryKeyC, rawC);

  await tickTimers(context, 1);

  assert.equal(storage.getItem(recoveryKeyA), rawA);
  assert.equal(storage.getItem(recoveryKeyB), rawB);
  assert.equal(storage.getItem(recoveryKeyC), null);
});

test("proactive artifact sweep는 같은 storage의 page-session에서 한 번만 실행한다", { concurrency: false }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const activeKey = createDocumentDraftKey("note", "student-1", "active-once");
  const firstInactiveKey = createDocumentDraftKey(
    "note",
    "student-1",
    "inactive-first",
  );
  const secondInactiveKey = createDocumentDraftKey(
    "note",
    "student-1",
    "inactive-second",
  );
  const harness = await createDraftHookHarness(context, activeKey);
  const storage = harness.browserWindow.localStorage;
  const expiredAt = Date.now() - FORM_DRAFT_RECOVERY_TTL_MS - 1;
  const firstRaw = serializeFormDraft(draft("first inactive"), expiredAt);
  const firstRecoveryKey = createImmutableFormDraftRecoveryKey(
    firstInactiveKey,
    "first",
    firstRaw,
  );
  storage.setItem(firstRecoveryKey, firstRaw);

  await tickTimers(context, 1);
  assert.equal(storage.getItem(firstRecoveryKey), null);

  const secondRaw = serializeFormDraft(draft("second inactive"), expiredAt);
  const secondRecoveryKey = createImmutableFormDraftRecoveryKey(
    secondInactiveKey,
    "second",
    secondRaw,
  );
  storage.setItem(secondRecoveryKey, secondRaw);
  await harness.remount(activeKey);
  await tickTimers(context, 1);

  assert.equal(storage.getItem(secondRecoveryKey), secondRaw);
});

test("quota retry는 inactive 전역 artifact를 먼저 정리한 뒤 current draft 저장을 재시도한다", { concurrency: false }, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const activeKey = createDocumentDraftKey("note", "student-1", "quota-active");
  const inactiveKey = createDocumentDraftKey(
    "community-post",
    "student-1",
    "quota-inactive",
  );
  const harness = await createDraftHookHarness(context, activeKey);
  const storage = harness.browserWindow.localStorage;
  await tickTimers(context, 1);

  const expiredAt = Date.now() - FORM_DRAFT_RECOVERY_TTL_MS - 1;
  const inactiveRaw = serializeFormDraft(draft("quota inactive"), expiredAt);
  const inactiveRecoveryKey = createImmutableFormDraftRecoveryKey(
    inactiveKey,
    "quota-inactive",
    inactiveRaw,
  );
  const inactiveMarkerKey = createFormDraftClearMarkerKey(inactiveKey);
  const inactiveMarkerRaw = JSON.stringify({
    version: FORM_DRAFT_CLEAR_MARKER_VERSION,
    signature: createFormDraftDataSignature(draft("old submitted")),
    clearedAt: expiredAt,
  });
  storage.setItem(inactiveRecoveryKey, inactiveRaw);
  storage.setItem(inactiveMarkerKey, inactiveMarkerRaw);

  const ownSetItemDescriptor = Object.getOwnPropertyDescriptor(storage, "setItem");
  const originalSetItem = storage.setItem.bind(storage);
  let quotaInjected = false;
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: (storageKey: string, raw: string) => {
      if (
        !quotaInjected &&
        storageKey.startsWith(createFormDraftRecoveryPrefix(activeKey))
      ) {
        quotaInjected = true;
        const quotaError = new Error("localStorage quota exceeded");
        quotaError.name = "QuotaExceededError";
        throw quotaError;
      }
      originalSetItem(storageKey, raw);
    },
  });

  try {
    const activeDraft = draft("quota retry active draft");
    await act(async () => {
      harness.getResult().save(activeDraft);
      assert.equal(harness.getResult().flush(), true);
    });

    assert.equal(quotaInjected, true);
    assert.equal(storage.getItem(inactiveRecoveryKey), null);
    assert.equal(storage.getItem(inactiveMarkerKey), null);
    assert.deepEqual(readDraft(storage, activeKey), activeDraft);
    assert.equal(listRecoveryKeys(storage, activeKey).length, 1);
  } finally {
    if (ownSetItemDescriptor) {
      Object.defineProperty(storage, "setItem", ownSetItemDescriptor);
    } else {
      Reflect.deleteProperty(storage, "setItem");
    }
  }
});

test("marker 이후 같은 signature로 새로 쓴 draft는 지연된 제출 이벤트에도 보존한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-new-after-marker");
  const repeatedDraft = draft("다시 시작한 같은 내용");
  const harness = await createDraftHookHarness(context, draftKey);
  const { browserWindow } = harness;
  const marker = writeFormDraftClearMarker(
    browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(repeatedDraft),
    Date.now() - 1_000,
  );

  await act(async () => {
    harness.getResult().save(repeatedDraft);
    harness.getResult().flush();
  });
  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: createFormDraftClearMarkerKey(draftKey),
        newValue: marker.raw,
        storageArea: browserWindow.localStorage,
        url: browserWindow.location.href,
      }),
    );
  });

  assert.deepEqual(readDraft(browserWindow.localStorage, draftKey), repeatedDraft);
  assert.notEqual(browserWindow.localStorage.getItem(createFormDraftClearMarkerKey(draftKey)), null);
  assert.equal(harness.getResult().status, "saved");
});

test("marker 전에 대기하던 동일 signature pending은 flush 시 ghost로 저장하지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("qna-thread", "student-1", "thread-stale-pending");
  const submittedDraft = draft("제출 직전 pending");
  const harness = await createDraftHookHarness(context, draftKey);
  const { browserWindow } = harness;

  await act(async () => {
    harness.getResult().save(submittedDraft);
  });
  writeFormDraftClearMarker(
    browserWindow.localStorage,
    draftKey,
    createFormDraftDataSignature(submittedDraft),
    Date.now() + 1_000,
  );
  await act(async () => {
    harness.getResult().flush();
  });

  assert.equal(browserWindow.localStorage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(browserWindow.localStorage, draftKey).length, 0);
  assert.equal(harness.getResult().status, "idle");
});

test("persist 도중 생긴 제출 marker는 post-check에서 snapshot을 정리하고 폼을 reset한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("qna-thread", "student-1", "thread-marker-toctou");
  const submittedDraft = draft("저장 도중 제출된 내용");
  const submittedSignature = createFormDraftDataSignature(submittedDraft);
  const harness = await createDraftHookHarness(context, draftKey);
  const storage = harness.browserWindow.localStorage;
  const originalSetItem = storage.setItem.bind(storage);
  const resetCount = harness.resetCounts[0];
  let markerInjected = false;
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: (storageKey: string, raw: string) => {
      if (
        !markerInjected &&
        storageKey.startsWith(createFormDraftRecoveryPrefix(draftKey))
      ) {
        markerInjected = true;
        writeFormDraftClearMarker(
          storage,
          draftKey,
          submittedSignature,
          Date.now() + 1_000,
        );
      }
      originalSetItem(storageKey, raw);
    },
  });

  await act(async () => {
    harness.getResult().save(submittedDraft);
    assert.equal(harness.getResult().flush(), true);
  });

  assert.equal(markerInjected, true);
  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(harness.resetCounts[0], resetCount + 1);
  assert.equal(harness.getResult().status, "idle");
});

test("제출 marker가 quota로 끝내 기록되지 않으면 제출 snapshot을 지우고 error를 표시한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-marker-quota");
  const submittedDraft = draft("서버에는 제출된 내용");
  const harness = await createDraftHookHarness(context, draftKey, undefined, 2);
  const storage = harness.browserWindow.localStorage;

  await act(async () => {
    harness.getResult(0).save(submittedDraft);
    assert.equal(harness.getResult(0).flush(), true);
    harness.getResult(1).save(submittedDraft);
  });
  assert.deepEqual(readDraft(storage, draftKey), submittedDraft);

  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: (storageKey: string, raw: string) => {
      if (isFormDraftClearMarkerKey(draftKey, storageKey)) {
        const quotaError = new Error("localStorage quota exceeded");
        quotaError.name = "QuotaExceededError";
        throw quotaError;
      }
      originalSetItem(storageKey, raw);
    },
  });

  await act(async () => {
    harness.getResult(0).clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
    assert.equal(harness.getResult(1).flush(), false);
  });

  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(readFormDraftClearMarker(storage, draftKey), null);
  assert.equal(harness.getResult(0).status, "error");
  assert.equal(harness.getResult(1).status, "error");

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await act(async () => {
    assert.equal(harness.getResult(1).flush(), true);
  });
  assert.ok(readFormDraftClearMarker(storage, draftKey));
});

test("제출 marker가 SecurityError로 실패해도 snapshot 정리와 peer 통지를 수행한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-marker-security");
  const submittedDraft = draft("접근 오류 중 서버 제출 내용");
  const harness = await createDraftHookHarness(context, draftKey, undefined, 2);
  const storage = harness.browserWindow.localStorage;

  await act(async () => {
    harness.getResult(0).save(submittedDraft);
    assert.equal(harness.getResult(0).flush(), true);
    harness.getResult(1).save(submittedDraft);
  });

  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: (storageKey: string, raw: string) => {
      if (isFormDraftClearMarkerKey(draftKey, storageKey)) {
        const securityError = new Error("localStorage marker access denied");
        securityError.name = "SecurityError";
        throw securityError;
      }
      originalSetItem(storageKey, raw);
    },
  });

  await act(async () => {
    harness.getResult(0).clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
  });

  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(readFormDraftClearMarker(storage, draftKey), null);
  assert.equal(harness.getResult(0).status, "error");
  assert.equal(harness.getResult(1).status, "error");

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await act(async () => {
    assert.equal(harness.getResult(1).flush(), true);
  });
  assert.ok(readFormDraftClearMarker(storage, draftKey));
});

test("storage 전면 차단 중 제출은 page-session marker로 ghost를 막고 회복 뒤 newer 동일본만 보존한다", { concurrency: false }, async (context) => {
  const originalNow = Date.now;
  const clearedAt = originalNow() + 10_000;
  let currentTime = clearedAt - 100;
  Object.defineProperty(Date, "now", {
    configurable: true,
    value: () => currentTime,
  });

  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-submitted-storage-denied",
  );
  const firstAwayKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-submitted-storage-denied-away-a",
  );
  const secondAwayKey = createDocumentDraftKey(
    "note",
    "student-1",
    "note-submitted-storage-denied-away-b",
  );
  const submittedDraft = draft("서버에는 제출된 동일 내용");
  const staleRaw = serializeFormDraft(submittedDraft, clearedAt - 1_000);
  const staleRecoveryKey = createImmutableFormDraftRecoveryKey(
    draftKey,
    "stale-writer",
    staleRaw,
  );
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => {
      storage.setItem(draftKey, staleRaw);
      storage.setItem(staleRecoveryKey, staleRaw);
    },
    2,
  );
  const storage = harness.browserWindow.localStorage;
  const restoresBeforeClear = harness.restoredDrafts.length;
  const blockedStorage = blockFormDraftStorage(storage);
  let storageRestored = false;

  try {
    await act(async () => {
      harness.getResult(1).save(submittedDraft);
    });
    currentTime = clearedAt;
    await act(async () => {
      harness.getResult(0).clear({
        reason: "submitted",
        submittedData: submittedDraft,
      });
    });

    assert.equal(harness.getResult(0).status, "error");
    const unresolvedUnload = new harness.browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    await act(async () => {
      harness.browserWindow.dispatchEvent(unresolvedUnload);
    });
    assert.equal(unresolvedUnload.defaultPrevented, true);

    await harness.renderKeys([firstAwayKey, secondAwayKey]);
    await harness.renderKeys([draftKey, draftKey]);
    assert.equal(
      harness.restoredDrafts.length,
      restoresBeforeClear,
      "cutoff 이전 canonical과 volatile pending을 A→B→A에서 복원하면 안 됩니다.",
    );

    const newerRecoverySavedAt = clearedAt + 500;
    const newerRecoveryRaw = serializeFormDraft(
      submittedDraft,
      newerRecoverySavedAt,
    );
    const newerRecoveryKey = createImmutableFormDraftRecoveryKey(
      draftKey,
      "newer-writer",
      newerRecoveryRaw,
    );
    blockedStorage.setItem(newerRecoveryKey, newerRecoveryRaw);

    const newerPendingAt = clearedAt + 1_000;
    currentTime = newerPendingAt;
    await act(async () => {
      harness.getResult(0).save(submittedDraft);
    });
    await harness.renderKeys([firstAwayKey, secondAwayKey]);
    await harness.renderKeys([draftKey, draftKey]);

    assert.deepEqual(harness.restoredDrafts.at(-1), submittedDraft);
    assert.equal(harness.getResult(0).savedAt?.getTime(), newerPendingAt);
    const stillUnresolvedUnload = new harness.browserWindow.Event(
      "beforeunload",
      { cancelable: true },
    );
    await act(async () => {
      harness.browserWindow.dispatchEvent(stillUnresolvedUnload);
    });
    assert.equal(stillUnresolvedUnload.defaultPrevented, true);

    blockedStorage.restore();
    storageRestored = true;
    let recoveredFlush = false;
    await act(async () => {
      recoveredFlush = harness.getResult(0).flush();
    });
    assert.equal(
      recoveredFlush,
      true,
      `status=${harness.getResult(0).status}, marker=${String(readFormDraftClearMarker(storage, draftKey)?.clearedAt.getTime())}, canonical=${String(parseFormDraft<DraftData>(storage.getItem(draftKey) ?? "")?.savedAt?.getTime())}`,
    );

    const durableMarker = readFormDraftClearMarker(storage, draftKey);
    assert.ok(durableMarker);
    assert.equal(durableMarker.clearedAt.getTime(), clearedAt);
    assert.equal(storage.getItem(staleRecoveryKey), null);
    assert.equal(storage.getItem(newerRecoveryKey), newerRecoveryRaw);
    const persistedRaw = storage.getItem(draftKey);
    assert.ok(persistedRaw);
    const persisted = parseFormDraft<DraftData>(persistedRaw);
    assert.deepEqual(persisted?.data, submittedDraft);
    assert.equal(persisted?.savedAt?.getTime(), newerPendingAt);

    await harness.remount(draftKey, 1);
    assert.deepEqual(harness.restoredDrafts.at(-1), submittedDraft);
    assert.equal(harness.getResult().savedAt?.getTime(), newerPendingAt);

    const resolvedUnload = new harness.browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    await act(async () => {
      harness.browserWindow.dispatchEvent(resolvedUnload);
    });
    assert.equal(resolvedUnload.defaultPrevented, false);
  } finally {
    if (!storageRestored) blockedStorage.restore();
    try {
      await act(async () => {
        harness.getResult().flush();
      });
    } catch {
      // 실패 assertion 뒤에도 module-level volatile 상태가 다음 테스트에 새지 않게 정리한다.
    }
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: originalNow,
    });
  }
});

test("A 제출 marker는 storage 회복 뒤 B flush가 실패해도 pagehide에서 durable화된다", { concurrency: false }, async (context) => {
  const submittedKey = createDocumentDraftKey(
    "note",
    "student-1",
    "submitted-away-key",
  );
  const activeKey = createDocumentDraftKey(
    "note",
    "student-1",
    "submitted-away-active-key",
  );
  const submittedDraft = draft("A에서 서버 제출한 내용");
  const staleRaw = serializeFormDraft(submittedDraft, Date.now() - 1_000);
  const staleRecoveryKey = createImmutableFormDraftRecoveryKey(
    submittedKey,
    "stale-away-writer",
    staleRaw,
  );
  const harness = await createDraftHookHarness(
    context,
    submittedKey,
    (storage) => {
      storage.setItem(submittedKey, staleRaw);
      storage.setItem(staleRecoveryKey, staleRaw);
    },
  );
  const storage = harness.browserWindow.localStorage;
  const blockedStorage = blockFormDraftStorage(storage);
  let storageRestored = false;

  try {
    await act(async () => {
      harness.getResult().clear({
        reason: "submitted",
        submittedData: submittedDraft,
      });
    });
    await harness.render(activeKey);

    blockedStorage.restore();
    storageRestored = true;
    const circularActiveDraft = draft("B의 직렬화 불가 현재 입력") as DraftData & {
      self?: unknown;
    };
    circularActiveDraft.self = circularActiveDraft;
    await act(async () => {
      harness.getResult().save(circularActiveDraft);
    });
    await act(async () => {
      harness.browserWindow.dispatchEvent(
        new harness.browserWindow.Event("pagehide"),
      );
    });

    const marker = readFormDraftClearMarker(storage, submittedKey);
    assert.ok(marker);
    assert.equal(storage.getItem(submittedKey), null);
    assert.equal(storage.getItem(staleRecoveryKey), null);

    await act(async () => {
      harness.getResult().save(draft("B의 복구 가능한 현재 입력"));
      assert.equal(harness.getResult().flush(), true);
    });

    const resolvedUnload = new harness.browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    await act(async () => {
      harness.browserWindow.dispatchEvent(resolvedUnload);
    });
    assert.equal(resolvedUnload.defaultPrevented, false);
  } finally {
    if (!storageRestored) blockedStorage.restore();
  }
});

test("A orphan draft는 B 이탈 전 경고하고 storage 회복 뒤 B pagehide에서 recovery로 승격한다", { concurrency: false }, async (context) => {
  const orphanKey = createDocumentDraftKey(
    "community-post",
    "student-1",
    "orphan-away-key",
  );
  const activeKey = createDocumentDraftKey(
    "community-post",
    "student-1",
    "orphan-away-active-key",
  );
  const orphanDraft = draft("A에서 영속화하지 못한 입력");
  const harness = await createDraftHookHarness(context, orphanKey);
  const storage = harness.browserWindow.localStorage;
  const blockedStorage = blockFormDraftStorage(storage);
  let storageRestored = false;

  try {
    await act(async () => {
      harness.getResult().save(orphanDraft);
    });
    await harness.render(activeKey);

    const unresolvedUnload = new harness.browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    await act(async () => {
      harness.browserWindow.dispatchEvent(unresolvedUnload);
    });
    assert.equal(unresolvedUnload.defaultPrevented, true);

    blockedStorage.restore();
    storageRestored = true;
    await act(async () => {
      harness.browserWindow.dispatchEvent(
        new harness.browserWindow.Event("pagehide"),
      );
    });

    const recoveryKeys = listRecoveryKeys(storage, orphanKey);
    assert.equal(recoveryKeys.length, 1);
    assert.deepEqual(readDraft(storage, recoveryKeys[0]!), orphanDraft);
    assert.equal(storage.getItem(orphanKey), null);

    const resolvedUnload = new harness.browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    await act(async () => {
      harness.browserWindow.dispatchEvent(resolvedUnload);
    });
    assert.equal(resolvedUnload.defaultPrevented, false);
  } finally {
    if (!storageRestored) blockedStorage.restore();
  }
});

test("global beforeunload guard는 hook 정리 후에도 회복된 storage로 orphan을 drain한다", { concurrency: false }, async (context) => {
  const orphanKey = createDocumentDraftKey(
    "community-post",
    "student-1",
    "orphan-global-beforeunload",
  );
  const activeKey = createDocumentDraftKey(
    "community-post",
    "student-1",
    "orphan-global-beforeunload-away",
  );
  const orphanDraft = draft("global guard가 영속화할 입력");
  const harness = await createDraftHookHarness(context, orphanKey);
  const storage = harness.browserWindow.localStorage;
  const blockedStorage = blockFormDraftStorage(storage);
  let storageRestored = false;

  try {
    await act(async () => {
      harness.getResult().save(orphanDraft);
    });
    await harness.render(activeKey);
    await harness.unmount();

    blockedStorage.restore();
    storageRestored = true;
    const unload = new harness.browserWindow.Event("beforeunload", {
      cancelable: true,
    });
    harness.browserWindow.dispatchEvent(unload);

    assert.equal(unload.defaultPrevented, false);
    const recoveryKeys = listRecoveryKeys(storage, orphanKey);
    assert.equal(recoveryKeys.length, 1);
    assert.deepEqual(readDraft(storage, recoveryKeys[0]!), orphanDraft);
  } finally {
    if (!storageRestored) blockedStorage.restore();
  }
});

test("시계 역행 뒤 같은 signature를 다시 clear해도 더 강한 volatile cutoff를 낮추지 않는다", { concurrency: false }, async (context) => {
  const originalNow = Date.now;
  const baseTime = originalNow();
  let currentTime = baseTime;
  Object.defineProperty(Date, "now", {
    configurable: true,
    value: () => currentTime,
  });

  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "submitted-clock-rollback",
  );
  const submittedDraft = draft("시계 역행 전 제출한 내용");
  const staleRaw = serializeFormDraft(submittedDraft, baseTime + 150);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, staleRaw),
  );
  const storage = harness.browserWindow.localStorage;
  const blockedStorage = blockFormDraftStorage(storage);
  let storageRestored = false;

  try {
    currentTime = baseTime + 200;
    await act(async () => {
      harness.getResult().clear({
        reason: "submitted",
        submittedData: submittedDraft,
      });
    });

    blockedStorage.restore();
    storageRestored = true;
    currentTime = baseTime + 100;
    await act(async () => {
      harness.getResult().clear({
        reason: "submitted",
        submittedData: submittedDraft,
      });
    });

    const marker = readFormDraftClearMarker(storage, draftKey, baseTime + 200);
    assert.ok(marker);
    assert.equal(marker.clearedAt.getTime(), baseTime + 200);
    assert.equal(storage.getItem(draftKey), null);

    const restoresBeforeRemount = harness.restoredDrafts.length;
    await harness.remount(draftKey);
    assert.equal(harness.restoredDrafts.length, restoresBeforeRemount);
  } finally {
    if (!storageRestored) blockedStorage.restore();
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: originalNow,
    });
  }
});

test("최초 제출에서 시계가 역행하고 storage가 차단돼도 관측한 savedAt까지 clear한다", { concurrency: false }, async (context) => {
  const originalNow = Date.now;
  const baseTime = originalNow();
  let currentTime = baseTime + 200;
  Object.defineProperty(Date, "now", {
    configurable: true,
    value: () => currentTime,
  });

  const draftKey = createDocumentDraftKey(
    "note",
    "student-1",
    "submitted-first-clock-rollback",
  );
  const submittedDraft = draft("최초 제출 전 미래 시각 저장본");
  const staleRaw = serializeFormDraft(submittedDraft, currentTime);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, staleRaw),
  );
  const storage = harness.browserWindow.localStorage;
  const blockedStorage = blockFormDraftStorage(storage);
  let storageRestored = false;

  try {
    currentTime = baseTime + 100;
    await act(async () => {
      harness.getResult().clear({
        reason: "submitted",
        submittedData: submittedDraft,
      });
    });
    assert.equal(harness.getResult().status, "error");

    blockedStorage.restore();
    storageRestored = true;
    await act(async () => {
      assert.equal(harness.getResult().flush(), true);
    });

    const marker = readFormDraftClearMarker(storage, draftKey, baseTime + 200);
    assert.ok(marker);
    assert.equal(marker.clearedAt.getTime(), baseTime + 200);
    assert.equal(storage.getItem(draftKey), null);
    const restoresBeforeRemount = harness.restoredDrafts.length;
    await harness.remount(draftKey);
    assert.equal(harness.restoredDrafts.length, restoresBeforeRemount);
  } finally {
    if (!storageRestored) blockedStorage.restore();
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: originalNow,
    });
  }
});

test("충돌 처리 중 flush quota 실패는 conflict로 덮지 않고 pending을 재시도한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-flush-quota");
  const initialDraft = draft("처음 복원한 내용");
  const externalDraft = draft("다른 탭 canonical");
  const pendingDraft = draft("현재 탭 pending");
  const initialRaw = serializeFormDraft(initialDraft, Date.now() - 2_000);
  const externalRaw = serializeFormDraft(externalDraft, Date.now() - 1_000);
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => storage.setItem(draftKey, initialRaw),
  );
  const { browserWindow } = harness;
  const storage = browserWindow.localStorage;

  await act(async () => {
    harness.getResult().save(pendingDraft);
  });

  const originalSetItem = storage.setItem.bind(storage);
  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: () => {
      const quotaError = new Error("localStorage quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    },
  });
  originalSetItem(draftKey, externalRaw);

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.StorageEvent("storage", {
        key: draftKey,
        oldValue: initialRaw,
        newValue: externalRaw,
        storageArea: storage,
        url: browserWindow.location.href,
      }),
    );
  });
  assert.equal(harness.getResult().status, "error");

  Object.defineProperty(storage, "setItem", {
    configurable: true,
    value: originalSetItem,
  });
  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });

  assert.deepEqual(readDraft(storage, draftKey), externalDraft);
  assert.equal(
    listRecoveryKeys(storage, draftKey)
      .map((storageKey) => readDraft(storage, storageKey))
      .some((storedDraft) => storedDraft?.title === pendingDraft.title),
    true,
  );
  assert.equal(harness.getResult().status, "conflict");
});

test("X와 Y 연속 제출 뒤에도 잠든 탭의 제출 전 X pending을 ghost로 복원하지 않는다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("note", "student-1", "note-sequential-submit");
  const firstSubmittedDraft = draft("첫 제출 내용");
  const secondSubmittedDraft = draft("둘째 제출 내용");
  const harness = await createDraftHookHarness(context, draftKey);
  const storage = harness.browserWindow.localStorage;

  await act(async () => {
    harness.getResult().save(firstSubmittedDraft);
  });
  const firstSubmittedAt = Date.now() + 1_000;
  writeFormDraftClearMarker(
    storage,
    draftKey,
    createFormDraftDataSignature(firstSubmittedDraft),
    firstSubmittedAt,
  );
  writeFormDraftClearMarker(
    storage,
    draftKey,
    createFormDraftDataSignature(secondSubmittedDraft),
    firstSubmittedAt + 1_000,
  );

  await act(async () => {
    harness.getResult().flush();
  });

  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(harness.getResult().status, "idle");
});

test("30일 TTL 안의 제출이 64개를 넘어도 첫 pending tombstone을 유지한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "new");
  const firstSubmittedDraft = draft("첫 제출 뒤 잠든 pending");
  const harness = await createDraftHookHarness(context, draftKey);
  const storage = harness.browserWindow.localStorage;

  await act(async () => {
    harness.getResult().save(firstSubmittedDraft);
  });
  const submittedAt = Date.now() + 1_000;
  writeFormDraftClearMarker(
    storage,
    draftKey,
    createFormDraftDataSignature(firstSubmittedDraft),
    submittedAt,
  );
  for (let index = 0; index < 65; index += 1) {
    writeFormDraftClearMarker(
      storage,
      draftKey,
      createFormDraftDataSignature(draft(`후속 제출 ${index}`)),
      submittedAt + index + 1,
    );
  }

  await act(async () => {
    assert.equal(harness.getResult().flush(), true);
  });

  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(harness.getResult().status, "idle");
});

test("제출 signature와 다른 pending은 clear marker 뒤에도 canonical과 shadow로 보존한다", { concurrency: false }, async (context) => {
  const draftKey = createDocumentDraftKey("community-post", "student-1", "post-submitted");
  const submittedDraft = draft("서버 제출 내용");
  const divergentDraft = draft("다른 탭 새 입력");
  const harness = await createDraftHookHarness(
    context,
    draftKey,
    (storage) => {
      storage.setItem(
        draftKey,
        serializeFormDraft(submittedDraft, 1_800_000_000_000),
      );
    },
    2,
  );

  await act(async () => {
    harness.getResult(1).save(divergentDraft);
  });
  await act(async () => {
    harness.getResult(0).clear({
      reason: "submitted",
      submittedData: submittedDraft,
    });
  });
  await act(async () => {
    harness.getResult(1).flush();
  });

  const storage = harness.browserWindow.localStorage;
  assert.deepEqual(readDraft(storage, draftKey), divergentDraft);
  assert.ok(readFormDraftClearMarker(storage, draftKey));
  const recoveryDrafts = listRecoveryKeys(storage, draftKey)
    .map((storageKey) => readDraft(storage, storageKey))
    .filter((storedDraft): storedDraft is DraftData => storedDraft !== null);
  assert.deepEqual(recoveryDrafts, [divergentDraft]);
  assert.equal(harness.getResult(1).status, "saved");
});
