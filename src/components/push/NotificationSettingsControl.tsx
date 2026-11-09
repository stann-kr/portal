"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { AccountDialogHandle } from "@/components/auth/LocalDraftManager";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPushSetup, removePushSubscription, savePushSubscription, sendTestPush, setPushCategory } from "@/lib/actions/push";
import type { PushCategory } from "@/lib/push/messages";
import {
  readCurrentSubscription,
  readNotificationPermission,
  readPushOwner,
  readPushSupport,
  unsubscribeThisDevice,
  writePushOwner,
} from "./push-client";
import { enablePushOnThisDevice, OPEN_NOTIFICATION_SETTINGS_EVENT } from "./enable-device";
import { PushSwitch } from "./PushSwitch";

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

type CategoryRow = { category: PushCategory; label: string; description: string };

/** 역할별로 받을 수 있는 알림 종류(캔버스 NotificationSettings "받을 알림"). */
const CATEGORY_ROWS: Record<"student" | "admin", CategoryRow[]> = {
  student: [
    { category: "feedback", label: "과제 피드백", description: "내 과제에 피드백이 달리면" },
    { category: "assignment", label: "새 과제", description: "새 과제가 나오면" },
    { category: "lesson", label: "레슨 일정", description: "레슨이 잡히거나 바뀌면" },
    { category: "qna", label: "Q&A 답변", description: "내 질문에 답이 달리면" },
    { category: "announcement", label: "공지", description: "커뮤니티에 공지가 올라오면" },
    { category: "community_post", label: "커뮤니티 새 글", description: "누군가 새 글을 올리면" },
    { category: "community_comment", label: "댓글", description: "내 글이나 댓글 단 글에 새 댓글이 달리면" },
  ],
  admin: [
    { category: "assignment", label: "과제 제출", description: "학생이 과제를 내면" },
    { category: "lesson", label: "레슨 일정", description: "학생이 레슨을 옮기면" },
    { category: "qna", label: "Q&A", description: "새 질문이나 학생 답글이 오면" },
    { category: "community_post", label: "커뮤니티 새 글", description: "누군가 새 글을 올리면" },
    { category: "community_comment", label: "댓글", description: "내 글이나 댓글 단 글에 새 댓글이 달리면" },
  ],
};

/**
 * 브라우저에 남은 구독을 지금 계정 기준으로 맞춘다.
 * 이 계정이 켠 구독이면 서버에서 빠졌을 때 다시 등록하고, 다른 계정이 켜 둔 구독(세션 만료 뒤 다른 계정 로그인)은 해제한다.
 * 해제된 구독은 푸시 서비스가 410으로 답해 서버 행도 지워진다.
 */
async function reconcileSubscription(ownerId: string, subscription: PushSubscription, registered: boolean): Promise<"kept" | "released"> {
  if (readPushOwner() !== ownerId) {
    await unsubscribeThisDevice().catch(() => null);
    return "released";
  }
  if (!registered) {
    const saved = await savePushSubscription(subscription.toJSON());
    if (!saved.ok) return "released";
  }
  return "kept";
}

type LoadedState = { device: DeviceState; muted: PushCategory[] | null };

/** 이 기기 상태와 이 계정이 끈 종류를 읽는다. 종류는 서버 키가 있으면 기기와 관계없이 보인다(iPhone Safari 탭 포함). */
async function loadSettings(ownerId: string): Promise<LoadedState> {
  const support = readPushSupport();
  const permission = readNotificationPermission();
  const subscription = support === "supported" ? await readCurrentSubscription().catch(() => null) : null;
  const setup = await getPushSetup(subscription?.endpoint ?? null);
  if (!setup.publicKey) return { device: { kind: "unavailable" }, muted: null };
  const muted = setup.mutedCategories;
  if (support !== "supported") return { device: { kind: support }, muted };
  if (permission === "denied") return { device: { kind: "blocked" }, muted };
  if (subscription && permission === "granted") {
    if (!setup.registered) {
      const result = await reconcileSubscription(ownerId, subscription, false);
      if (result === "released") return { device: { kind: "off", publicKey: setup.publicKey }, muted };
      return { device: { kind: "on", publicKey: setup.publicKey, endpoint: subscription.endpoint, deviceCount: setup.deviceCount + 1 }, muted };
    }
    // 서버에 이 계정으로 등록된 기기다: 주인 표시가 비었으면(다른 탭에서 켬 등) 채운다.
    writePushOwner(ownerId);
    return { device: { kind: "on", publicKey: setup.publicKey, endpoint: subscription.endpoint, deviceCount: setup.deviceCount }, muted };
  }
  return { device: { kind: "off", publicKey: setup.publicKey }, muted };
}

let backgroundSyncStarted = false;

/**
 * 화면을 열 때 한 번: 알림을 켜 둔 기기면 Service Worker를 갱신하고, 구독을 지금 계정 기준으로 맞춘다(reconcileSubscription).
 * 계정 메뉴가 데스크톱·서랍 두 곳에 있어도 한 번만 돈다.
 */
function syncSubscriptionInBackground(ownerId: string): void {
  if (backgroundSyncStarted) return;
  backgroundSyncStarted = true;
  if (readPushSupport() !== "supported" || readNotificationPermission() !== "granted") return;
  void (async () => {
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const subscription = await readCurrentSubscription();
      if (!subscription) return;
      const setup = await getPushSetup(subscription.endpoint);
      if (!setup.publicKey) return;
      if (setup.registered) writePushOwner(ownerId);
      else await reconcileSubscription(ownerId, subscription, false);
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
            <span>홈 화면의 Portal을 열어 다시 로그인하고, 이 화면에서 알림을 켭니다.</span>
          </li>
        </ol>
      </section>
    );
  }

  if (state.kind === "off" || state.kind === "on") {
    const on = state.kind === "on";
    return (
      <section aria-busy={pending !== null || undefined} className={DEVICE_BOX_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="push-device-title" className="text-body font-medium">이 기기에서 알림 받기</h3>
            <p id="push-device-desc" className="text-ui text-muted-foreground">
              {pending === "enable"
                ? "켜는 중…"
                : on
                  ? `이 계정에 연결된 기기 ${state.deviceCount}대`
                  : "켜면 바로 브라우저 허용 창이 뜹니다."}
            </p>
          </div>
          <PushSwitch
            checked={on}
            labelledBy="push-device-title"
            describedBy="push-device-desc"
            disabled={pending !== null}
            onChange={(next) => (next ? onEnable() : onDisable())}
          />
        </div>
        {on ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button type="button" variant="outline" className={DEVICE_BUTTON_CLASS} pending={pending === "test"} disabled={pending !== null} onClick={onTest}>
              테스트 알림 보내기
            </Button>
            {feedbackLine}
          </div>
        ) : (
          feedbackLine
        )}
      </section>
    );
  }

  const description =
    state.kind === "loading"
      ? "확인하는 중입니다."
      : state.kind === "unsupported"
        ? "이 브라우저는 알림을 지원하지 않습니다. 다른 기기에서 켜 주세요."
        : state.kind === "unavailable"
          ? "지금은 포탈 알림을 켤 수 없습니다."
          : "이 브라우저에서 포탈 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 알림을 허용한 뒤 다시 열어 주세요.";

  return (
    <section aria-labelledby="push-device-title" aria-busy={state.kind === "loading" || undefined} className={DEVICE_BOX_CLASS}>
      <div className="flex flex-col gap-0.5">
        <h3 id="push-device-title" className="text-body font-medium">이 기기</h3>
        <p className="text-ui text-secondary-foreground">{description}</p>
      </div>
      {feedbackLine}
    </section>
  );
}

/** 받을 알림 종류. 계정 단위(모든 기기)이며 바꾸면 바로 저장하고, 실패하면 되돌린다. */
function CategorySection({
  rows,
  muted,
  onToggle,
  error,
}: {
  rows: CategoryRow[];
  muted: PushCategory[];
  onToggle: (category: PushCategory, enabled: boolean) => void;
  error: string | null;
}) {
  return (
    <fieldset className="m-0 flex flex-col border-0 p-0">
      <legend className="mb-1 p-0 text-xs text-secondary-foreground">받을 알림 · 이 계정의 모든 기기</legend>
      {rows.map((row, index) => {
        const labelId = `push-category-${row.category}`;
        return (
          <div
            key={row.category}
            className={`flex min-h-11 items-center justify-between gap-3 py-1.5 md:min-h-0 md:py-2 ${index < rows.length - 1 ? "border-b border-muted" : ""}`}
          >
            <div className="flex flex-col gap-0.5">
              <span id={labelId} className="text-md text-foreground md:text-body">{row.label}</span>
              <span id={`${labelId}-desc`} className="text-xs text-muted-foreground">{row.description}</span>
            </div>
            <PushSwitch
              checked={!muted.includes(row.category)}
              labelledBy={labelId}
              describedBy={`${labelId}-desc`}
              onChange={(enabled) => onToggle(row.category, enabled)}
            />
          </div>
        );
      })}
      {error ? <p role="alert" className="mt-2 rounded-md bg-destructive-muted px-2.5 py-2 text-xs text-destructive">{error}</p> : null}
    </fieldset>
  );
}

/** 계정 메뉴의 알림 설정(캔버스 NotificationSettings·MobileNotificationSheet 보드). */
export function NotificationSettingsControl({
  controlRef,
  ownerId,
  isAdmin,
}: {
  controlRef?: Ref<AccountDialogHandle>;
  /** 지금 로그인한 계정. 이 기기 구독의 주인과 비교한다. */
  ownerId: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeviceState>({ kind: "loading" });
  const [pending, setPending] = useState<"enable" | "disable" | "test" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [muted, setMuted] = useState<PushCategory[] | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    syncSubscriptionInBackground(ownerId);
  }, [ownerId]);

  // 홈의 "알림 받기" 줄(iPhone 안내)이 여는 요청. 계정 메뉴가 두 곳에 있어도 먼저 받은 한 곳만 연다.
  const openRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const handle = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      openRef.current();
    };
    window.addEventListener(OPEN_NOTIFICATION_SETTINGS_EVENT, handle);
    return () => window.removeEventListener(OPEN_NOTIFICATION_SETTINGS_EVENT, handle);
  }, []);

  const refresh = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setState({ kind: "loading" });
    let next: LoadedState;
    try {
      next = await loadSettings(ownerId);
    } catch {
      next = { device: { kind: "unavailable" }, muted: null };
    }
    if (loadId !== loadIdRef.current) return;
    setState(next.device);
    setMuted(next.muted);
  }, [ownerId]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return;
    setOpen(nextOpen);
    setFeedback(null);
    setCategoryError(null);
    if (nextOpen) void refresh();
  };
  useImperativeHandle(controlRef, () => ({ open: () => handleOpenChange(true) }));
  useEffect(() => {
    openRef.current = () => handleOpenChange(true);
  });

  const enable = () => {
    if (state.kind !== "off" || pending) return;
    const { publicKey } = state;
    setPending("enable");
    setFeedback(null);
    // 권한 요청은 누른 직후 첫 await여야 iPhone이 허용 창을 띄운다.
    void enablePushOnThisDevice(publicKey, ownerId)
      .then(async (result) => {
        if (result.kind === "blocked") setState({ kind: "blocked" });
        else if (result.kind === "failed") setFeedback({ tone: "error", text: result.error });
        else if (result.kind === "enabled") {
          await refresh();
          setFeedback({ tone: "status", text: "이 기기에서 알림을 켰습니다." });
        }
      })
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
          setFeedback({ tone: "status", text: "보냈습니다. 몇 초 안에 도착합니다." });
          return;
        }
        if (result.unregistered) await refresh();
        setFeedback({ tone: "error", text: result.error });
      })
      .catch(() => setFeedback({ tone: "error", text: "테스트 알림을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요." }))
      .finally(() => setPending(null));
  };

  const toggleCategory = (category: PushCategory, enabled: boolean) => {
    setCategoryError(null);
    const apply = (on: boolean) =>
      setMuted((current) => {
        const rest = (current ?? []).filter((item) => item !== category);
        return on ? rest : [...rest, category];
      });
    apply(enabled);
    void setPushCategory(category, enabled)
      .then((result) => {
        if (result.ok) return;
        apply(!enabled);
        setCategoryError(result.error);
      })
      .catch(() => {
        apply(!enabled);
        setCategoryError("설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dismissible={pending === null}>
        <DialogHeader>
          <DialogTitle>알림 설정</DialogTitle>
          <DialogDescription>포탈 소식을 이 기기의 알림으로 받습니다. 기기마다 따로 켭니다.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <DeviceSection state={state} pending={pending} feedback={feedback} onEnable={enable} onDisable={disable} onTest={test} />
          {muted ? (
            <CategorySection rows={CATEGORY_ROWS[isAdmin ? "admin" : "student"]} muted={muted} onToggle={toggleCategory} error={categoryError} />
          ) : null}
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
