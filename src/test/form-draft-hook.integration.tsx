import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  FORM_DRAFT_CLEAR_MARKER_TTL_MS,
  FORM_DRAFT_RECOVERY_TTL_MS,
  createDocumentDraftKey,
  createFormDraftDataSignature,
  createFormDraftClearMarkerEntryKey,
  createFormDraftClearMarkerKey,
  createFormDraftRecoveryKey,
  createFormDraftRecoveryPrefix,
  isFormDraftClearMarkerKey,
  parseFormDraft,
  readFormDraftClearMarker,
  removeFormDraftClearMarker,
  serializeFormDraft,
  writeFormDraftClearMarker,
} from "@/lib/form-draft";
import { useFormDraft } from "@/lib/hooks/useFormDraft";

type DraftData = {
  operationId?: string;
  title: string;
  contentHtml: string;
};

type DraftHookResult = ReturnType<typeof useFormDraft<DraftData>>;

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
  unmount: () => Promise<void>;
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
  initialKey: string,
  seed?: (storage: Storage) => void,
  instanceCount = 1,
): Promise<DraftHookHarness> {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  const restoreBrowserGlobals = installBrowserGlobals(browserWindow);
  seed?.(browserWindow.localStorage);

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
        debounceMs: 60_000,
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
    browserWindow.close();
    restoreBrowserGlobals();
  });

  await render(initialKey);

  return {
    browserWindow,
    restoredDrafts,
    resetCounts,
    render,
    renderKeys,
    remount,
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

  await act(async () => {
    harness.getResult().save(currentDraft);
    harness.getResult().flush();
  });

  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.equal(harness.getResult().status, "conflict");
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
  assert.equal(harness.getResult().status, "conflict");

  const nextCurrentDraft = draft("구버전 client 다시 입력");
  await act(async () => {
    harness.getResult().save(nextCurrentDraft);
    harness.getResult().flush();
  });
  assert.equal(storage.getItem(draftKey), futureRaw);
  assert.deepEqual(
    listRecoveryKeys(storage, draftKey).map((storageKey) => readDraft(storage, storageKey)),
    [nextCurrentDraft],
  );
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
  assert.equal(harness.getResult().status, "conflict");
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
  assert.equal(harness.getResult().status, "conflict");
  assert.deepEqual(harness.restoredDrafts, [selectedDraft]);
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
    assert.equal(harness.getResult(1).flush(), true);
  });

  assert.equal(storage.getItem(draftKey), null);
  assert.equal(listRecoveryKeys(storage, draftKey).length, 0);
  assert.equal(readFormDraftClearMarker(storage, draftKey), null);
  assert.equal(harness.getResult(0).status, "error");
  assert.equal(harness.getResult(1).status, "idle");
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
  assert.equal(harness.getResult(1).status, "idle");
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
