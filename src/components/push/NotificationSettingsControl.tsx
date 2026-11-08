"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { AccountDialogHandle } from "@/components/auth/LocalDraftManager";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPushSetup, removePushSubscription, savePushSubscription, sendTestPush } from "@/lib/actions/push";
import {
  readCurrentSubscription,
  readNotificationPermission,
  readPushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from "./push-client";

/**
 * 이 기기 칸의 상태(캔버스 NotificationSettings 보드).
 * needs-install: iPhone Safari 탭, blocked: 브라우저가 알림을 막음, unavailable: 서버 발신 키 없음.
 */
type DeviceState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "needs-install" }
  | { kind: "unavailable" }
  | { kind: "blocked" }
  | { kind: "off"; publicKey: string }
  | { kind: "on"; publicKey: string; endpoint: string; deviceCount: number };

type Feedback = { tone: "status" | "error"; text: string } | null;

const DEVICE_BOX_CLASS = "flex flex-col gap-3 rounded-touch border border-border p-4";
const DEVICE_BUTTON_CLASS = "h-11 rounded-touch text-body md:h-8 md:rounded-md md:text-ui";

const RECEIVED_KINDS = {
  student: "과제 피드백 · 새 과제 · 레슨 일정이 잡히거나 바뀔 때 · Q&A 답변 · 커뮤니티 공지",
  admin: "과제 제출 · 학생이 레슨을 옮길 때 · 새 질문과 학생 답글",
} as const;

async function loadDeviceState(): Promise<DeviceState> {
  const support = readPushSupport();
  if (support !== "supported") return { kind: support };
  if (readNotificationPermission() === "denied") return { kind: "blocked" };
  const subscription = await readCurrentSubscription().catch(() => null);
  const setup = await getPushSetup(subscription?.endpoint ?? null);
  if (!setup.publicKey) return { kind: "unavailable" };
  if (subscription && readNotificationPermission() === "granted") {
    if (!setup.registered) {
      // 브라우저에는 구독이 있는데 서버에 없다(연결이 끊겨 지워졌거나 브라우저가 바꿨다): 지금 계정으로 다시 등록한다.
      const saved = await savePushSubscription(subscription.toJSON());
      if (!saved.ok) return { kind: "off", publicKey: setup.publicKey };
      return { kind: "on", publicKey: setup.publicKey, endpoint: subscription.endpoint, deviceCount: setup.deviceCount + 1 };
    }
    return { kind: "on", publicKey: setup.publicKey, endpoint: subscription.endpoint, deviceCount: setup.deviceCount };
  }
  return { kind: "off", publicKey: setup.publicKey };
}

let backgroundSyncStarted = false;

/**
 * 화면을 열 때 한 번: 알림을 켜 둔 기기면 Service Worker를 갱신하고, 브라우저 구독이 서버에서 빠졌으면 다시 등록한다.
 * 계정 메뉴가 데스크톱·서랍 두 곳에 있어도 한 번만 돈다.
 */
function syncSubscriptionInBackground(): void {
  if (backgroundSyncStarted) return;
  backgroundSyncStarted = true;
  if (readPushSupport() !== "supported" || readNotificationPermission() !== "granted") return;
  void (async () => {
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const subscription = await readCurrentSubscription();
      if (!subscription) return;
      const setup = await getPushSetup(subscription.endpoint);
      if (setup.publicKey && !setup.registered) await savePushSubscription(subscription.toJSON());
    } catch {
      // 다음에 알림 설정을 열 때 다시 맞춘다.
    }
  })();
}

function DeviceSection({
  state,
  pending,
  feedback,
  onEnable,
  onDisable,
  onTest,
}: {
  state: DeviceState;
  pending: "enable" | "disable" | "test" | null;
  feedback: Feedback;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}) {
  const feedbackLine = feedback ? (
    feedback.tone === "error" ? (
      <p role="alert" className="rounded-md bg-destructive-muted px-2.5 py-2 text-xs text-destructive">{feedback.text}</p>
    ) : (
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{feedback.text}</p>
    )
  ) : null;

  if (state.kind === "needs-install") {
    return (
      <section aria-labelledby="push-device-title" className={DEVICE_BOX_CLASS}>
        <div className="flex flex-col gap-0.5">
          <h3 id="push-device-title" className="text-body font-medium">이 기기</h3>
          <p className="text-ui text-secondary-foreground">iPhone은 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다.</p>
        </div>
        <ol className="flex flex-col gap-2.5 text-ui">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px]">1</span>
            <span>
              Safari 아래의 공유 버튼{" "}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="공유" className="inline align-[-2px]">
                <path d="M12 3v12M8 7l4-4 4 4" />
                <path d="M5 11v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
              </svg>{" "}
              을 누릅니다.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px]">2</span>
            <span>‘홈 화면에 추가’를 고릅니다.</span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px]">3</span>
            <span>홈 화면의 Stann Lumo를 열어 다시 로그인하고, 이 화면에서 알림을 켭니다.</span>
          </li>
        </ol>
      </section>
    );
  }

  const description =
    state.kind === "loading"
      ? "확인하는 중입니다."
      : state.kind === "unsupported"
        ? "이 브라우저는 알림을 지원하지 않습니다. 다른 기기에서 켜 주세요."
        : state.kind === "unavailable"
          ? "지금은 포털 알림을 켤 수 없습니다."
          : state.kind === "blocked"
            ? "이 브라우저에서 포털 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 알림을 허용한 뒤 다시 열어 주세요."
            : state.kind === "off"
              ? "아직 알림을 받지 않습니다."
              : `알림을 받고 있습니다. 이 계정에 연결된 기기 ${state.deviceCount}대`;

  return (
    <section aria-labelledby="push-device-title" aria-busy={state.kind === "loading" || pending !== null || undefined} className={DEVICE_BOX_CLASS}>
      <div className="flex flex-col gap-0.5">
        <h3 id="push-device-title" className="text-body font-medium">이 기기</h3>
        <p className="text-ui text-secondary-foreground">{description}</p>
      </div>
      {state.kind === "off" ? (
        <Button type="button" className={`self-start ${DEVICE_BUTTON_CLASS}`} pending={pending === "enable"} onClick={onEnable}>
          {pending === "enable" ? "켜는 중…" : "이 기기에서 알림 받기"}
        </Button>
      ) : null}
      {state.kind === "on" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className={DEVICE_BUTTON_CLASS} pending={pending === "test"} disabled={pending !== null} onClick={onTest}>
            테스트 알림 보내기
          </Button>
          <Button type="button" variant="ghost" className={DEVICE_BUTTON_CLASS} pending={pending === "disable"} disabled={pending !== null} onClick={onDisable}>
            이 기기 끄기
          </Button>
        </div>
      ) : null}
      {feedbackLine}
    </section>
  );
}

/** 계정 메뉴의 알림 설정(캔버스 NotificationSettings·MobileNotificationSheet 보드). */
export function NotificationSettingsControl({
  controlRef,
  isAdmin,
}: {
  controlRef?: Ref<AccountDialogHandle>;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeviceState>({ kind: "loading" });
  const [pending, setPending] = useState<"enable" | "disable" | "test" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    syncSubscriptionInBackground();
  }, []);

  const refresh = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setState({ kind: "loading" });
    let next: DeviceState;
    try {
      next = await loadDeviceState();
    } catch {
      next = { kind: "unavailable" };
    }
    if (loadId === loadIdRef.current) setState(next);
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    setOpen(nextOpen);
    setFeedback(null);
    if (nextOpen) void refresh();
  };
  useImperativeHandle(controlRef, () => ({ open: () => handleOpenChange(true) }));

  const enable = () => {
    if (state.kind !== "off" || pending) return;
    const { publicKey } = state;
    setPending("enable");
    setFeedback(null);
    // 권한 요청은 누른 직후 첫 await여야 iPhone이 허용 창을 띄운다.
    void subscribeThisDevice(publicKey)
      .then(async (subscription) => {
        if (subscription === "denied") {
          setState(readNotificationPermission() === "denied" ? { kind: "blocked" } : { kind: "off", publicKey });
          return;
        }
        const saved = await savePushSubscription(subscription.toJSON());
        if (!saved.ok) {
          await subscription.unsubscribe().catch(() => false);
          setFeedback({ tone: "error", text: saved.error });
          return;
        }
        await refresh();
        setFeedback({ tone: "status", text: "이 기기에서 알림을 켰습니다." });
      })
      .catch(() => setFeedback({ tone: "error", text: "알림을 켜지 못했습니다. 잠시 뒤 다시 시도해 주세요." }))
      .finally(() => setPending(null));
  };

  const disable = () => {
    if (state.kind !== "on" || pending) return;
    const { publicKey, endpoint } = state;
    setPending("disable");
    setFeedback(null);
    void (async () => {
      try {
        await unsubscribeThisDevice();
        const removed = await removePushSubscription(endpoint);
        setState({ kind: "off", publicKey });
        setFeedback(removed.ok ? { tone: "status", text: "이 기기의 알림을 껐습니다." } : { tone: "error", text: removed.error });
      } catch {
        setFeedback({ tone: "error", text: "알림을 끄지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
      } finally {
        setPending(null);
      }
    })();
  };

  const test = () => {
    if (state.kind !== "on" || pending) return;
    const { endpoint } = state;
    setPending("test");
    setFeedback(null);
    void sendTestPush(endpoint)
      .then(async (result) => {
        if (result.ok) {
          setFeedback({ tone: "status", text: "테스트 알림을 보냈습니다. 몇 초 안에 도착합니다." });
          return;
        }
        if (result.unregistered) await refresh();
        setFeedback({ tone: "error", text: result.error });
      })
      .catch(() => setFeedback({ tone: "error", text: "테스트 알림을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요." }))
      .finally(() => setPending(null));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dismissible={pending === null}>
        <DialogHeader>
          <DialogTitle>알림 설정</DialogTitle>
          <DialogDescription>포털 소식을 이 기기의 알림으로 받습니다. 기기마다 따로 켭니다.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <DeviceSection state={state} pending={pending} feedback={feedback} onEnable={enable} onDisable={disable} onTest={test} />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-secondary-foreground">받는 알림</span>
            <p className="text-body text-foreground md:text-ui">{isAdmin ? RECEIVED_KINDS.admin : RECEIVED_KINDS.student}</p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Button type="button" variant="outline" className="h-11 flex-auto rounded-touch text-body md:h-8 md:flex-none md:rounded-md md:text-ui" disabled={pending !== null} onClick={() => handleOpenChange(false)}>
              닫기
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
