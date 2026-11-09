"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPushSetup } from "@/lib/actions/push";
import { enablePushOnThisDevice, requestOpenNotificationSettings } from "./enable-device";
import { readNotificationPermission, readPushSupport } from "./push-client";

const DISMISS_STORAGE_KEY = "portal:push-prompt-dismissed-at";
/** "나중에"를 누르면 이 기기에서 숨기는 기간. */
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

type PromptState =
  | { kind: "hidden" }
  | { kind: "ask"; publicKey: string }
  | { kind: "install" };

function dismissedRecently(now: number): boolean {
  try {
    const value = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 && now - value < DISMISS_MS;
  } catch {
    return false;
  }
}

function rememberDismiss(now: number): void {
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, String(now));
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 숨긴다.
  }
}

/** 이 기기에서 아직 알림을 켜지 않았고 허용 여부도 고르지 않았을 때만 보인다. */
async function readPromptState(): Promise<PromptState> {
  if (dismissedRecently(Date.now())) return { kind: "hidden" };
  const support = readPushSupport();
  if (support === "needs-install") return { kind: "install" };
  // 권한을 아직 고르지 않았다면 남아 있는 옛 구독이 있어도 알림이 표시되지 않으므로 안내한다.
  if (support !== "supported" || readNotificationPermission() !== "default") return { kind: "hidden" };
  const setup = await getPushSetup(null);
  return setup.publicKey ? { kind: "ask", publicKey: setup.publicKey } : { kind: "hidden" };
}

const COPY = {
  student: "피드백·새 과제·레슨 일정 변경·Q&A 답변·공지를 바로 알려 드립니다.",
  admin: "과제 제출·학생이 옮긴 레슨·새 질문과 학생 답글을 바로 알려 드립니다.",
} as const;

/** 홈·업무함 맨 위의 "알림 받기" 줄(캔버스 PushPrompt 보드). 누르면 바로 브라우저 허용 창을 띄운다. */
export function PushPromptBanner({ ownerId, isAdmin }: { ownerId: string; isAdmin: boolean }) {
  const [state, setState] = useState<PromptState>({ kind: "hidden" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readPromptState()
      .then((next) => { if (!cancelled) setState(next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (state.kind === "hidden") return null;

  const dismiss = () => {
    rememberDismiss(Date.now());
    setState({ kind: "hidden" });
  };

  const enable = () => {
    if (state.kind !== "ask" || pending) return;
    setPending(true);
    setError(null);
    void enablePushOnThisDevice(state.publicKey, ownerId).then((result) => {
      setPending(false);
      if (result.kind === "failed") setError(result.error);
      else if (result.kind === "dismissed") return;
      else setState({ kind: "hidden" });
    });
  };

  const install = state.kind === "install";
  return (
    <section
      aria-labelledby="push-prompt-title"
      className="flex flex-col gap-3 rounded-touch border border-border bg-sidebar px-4 py-3.5 md:flex-row md:items-center md:gap-4"
    >
      <div className="flex min-w-0 flex-1 gap-2.5 md:items-center md:gap-4">
        <Bell className="mt-0.5 size-[18px] shrink-0 text-secondary-foreground md:mt-0" strokeWidth={1.6} aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="push-prompt-title" className="text-md font-medium text-foreground md:text-body">
            {install ? "홈 화면에 추가하면 알림을 받을 수 있습니다" : "이 기기에서 포탈 알림을 받을까요?"}
          </h2>
          <p className="text-ui text-muted-foreground">
            {install ? "iPhone은 홈 화면에 추가한 앱에서만 포탈 알림을 받습니다." : isAdmin ? COPY.admin : COPY.student}
          </p>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
      <div className="flex gap-2 md:shrink-0">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 rounded-touch text-md md:h-8 md:flex-none md:rounded-md md:border-0 md:bg-transparent md:text-ui md:text-secondary-foreground"
          disabled={pending}
          onClick={dismiss}
        >
          나중에
        </Button>
        <Button
          type="button"
          className="h-11 flex-1 rounded-touch text-md md:h-8 md:flex-none md:rounded-md md:text-ui"
          pending={pending}
          onClick={install ? requestOpenNotificationSettings : enable}
        >
          {install ? "방법 보기" : "알림 받기"}
        </Button>
      </div>
    </section>
  );
}
