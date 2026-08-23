/** 로컬 복구 안전성과 계정 귀속 서버 동기화를 하나의 form draft API로 묶는다. */
"use client";

import { useCallback, useRef } from "react";
import {
  useDocumentServerDraftSync,
  type DocumentServerDraftSyncResult,
} from "@/lib/hooks/useDocumentServerDraftSync";
import {
  useFormDraft,
  type UseFormDraftResult,
} from "@/lib/hooks/useFormDraft";

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
  } = {},
): UseSyncedFormDraftResult<T> {
  const serverObserverRef = useRef<(draft: T) => void>(() => undefined);
  const localRef = useRef<UseFormDraftResult<T> | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const local = useFormDraft<T>(
    key,
    (draft) => {
      onRestoreRef.current(draft);
      // local restore도 서버본과 비교하되, 실제 CAS 전까지 원문을 보존한다.
      serverObserverRef.current(draft);
    },
    options,
  );
  localRef.current = local;

  const server = useDocumentServerDraftSync<T>(key, (draft) => {
    onRestoreRef.current(draft);
    // 서버본을 고른 경우에만 local canonical도 같은 데이터로 명시적으로 맞춘다.
    localRef.current?.save(draft);
    localRef.current?.flush();
  });
  serverObserverRef.current = server.observeLocalDraft;

  const save = useCallback((data: T) => {
    localRef.current?.save(data);
    serverObserverRef.current(data);
  }, []);

  const clearLocalServerDraft = server.clearLocalDraft;
  const clear = useCallback<UseFormDraftResult<T>["clear"]>((clearOptions) => {
    localRef.current?.clear(clearOptions);
    clearLocalServerDraft(clearOptions?.reason ?? "empty");
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
      isDifferentDevice: server.isDifferentDevice,
      useRemoteDraft: server.useRemoteDraft,
      keepLocalDraft: server.keepLocalDraft,
      discardRemoteDraft: server.discardRemoteDraft,
      refresh: server.refresh,
    },
  };
}
