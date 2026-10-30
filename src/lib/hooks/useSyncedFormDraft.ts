/** 로컬 복구 안전성과 계정 귀속 서버 동기화를 하나의 form draft API로 묶는다. */
"use client";

import { useCallback, useInsertionEffect, useRef } from "react";
import {
  useDocumentServerDraftSync,
  type DocumentServerDraftSyncOptions,
  type DocumentServerDraftSyncResult,
} from "@/lib/hooks/useDocumentServerDraftSync";
import {
  useFormDraft,
  type UseFormDraftResult,
} from "@/lib/hooks/useFormDraft";

const EMPTY_SERVER_OPTIONS: DocumentServerDraftSyncOptions<unknown> = {};

export type UseSyncedFormDraftResult<T> = UseFormDraftResult<T> & {
  serverSync: DocumentServerDraftSyncResult;
};

export function useSyncedFormDraft<T>(
  key: string,
  onRestore: (draft: T) => void,
  options: {
    debounceMs?: number;
    maxWaitMs?: number;
    onReset?: () => void;
    /** 서버 초안 비교·폐기 규칙. 로컬 초안 계약에는 영향이 없다. */
    server?: DocumentServerDraftSyncOptions<T>;
  } = {},
): UseSyncedFormDraftResult<T> {
  const serverObserverRef = useRef<(draft: T) => void>(() => undefined);
  const localRef = useRef<UseFormDraftResult<T> | null>(null);
  const onRestoreRef = useRef(onRestore);

  const local = useFormDraft<T>(
    key,
    (draft) => {
      onRestoreRef.current(draft);
      // local restore도 서버본과 비교하되, 실제 CAS 전까지 원문을 보존한다.
      serverObserverRef.current(draft);
    },
    options,
  );

  // 비교·폐기 규칙은 hook 안에서 ref로 최신값을 읽으므로 매 render의 객체를 그대로 넘겨도 된다.
  const server = useDocumentServerDraftSync<T>(key, (draft) => {
    onRestoreRef.current(draft);
    // 서버본을 고른 경우에만 local canonical도 같은 데이터로 명시적으로 맞춘다.
    localRef.current?.save(draft);
    localRef.current?.flush();
  }, options.server ?? (EMPTY_SERVER_OPTIONS as DocumentServerDraftSyncOptions<T>));
  const observeLocalDraft = server.observeLocalDraft;
  // 자식의 layout/passive effect와 하위 hook의 mount effect가 save·restore를 부르기 전에
  // 최신 callback과 결과가 보이도록 insertion effect에서 갱신한다.
  useInsertionEffect(() => {
    onRestoreRef.current = onRestore;
    localRef.current = local;
    serverObserverRef.current = observeLocalDraft;
  }, [local, observeLocalDraft, onRestore]);

  const save = useCallback((data: T) => {
    localRef.current?.save(data);
    serverObserverRef.current(data);
  }, []);

  const clearLocalServerDraft = server.clearLocalDraft;
  const clear = useCallback<UseFormDraftResult<T>["clear"]>((clearOptions) => {
    localRef.current?.clear(clearOptions);
    clearLocalServerDraft(clearOptions?.reason ?? "empty", clearOptions);
  }, [clearLocalServerDraft]);

  return {
    ...local,
    save,
    clear,
    serverSync: {
      status: server.status,
      remoteDraft: server.remoteDraft,
      remotePreview: server.remotePreview,
      localPreview: server.localPreview,
      queuedPreview: server.queuedPreview,
      isDifferentDevice: server.isDifferentDevice,
      useRemoteDraft: server.useRemoteDraft,
      keepLocalDraft: server.keepLocalDraft,
      restoreQueuedDraft: server.restoreQueuedDraft,
      discardRemoteDraft: server.discardRemoteDraft,
      refresh: server.refresh,
    },
  };
}
