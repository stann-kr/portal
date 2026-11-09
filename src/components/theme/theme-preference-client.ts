"use client";

import { useSyncExternalStore } from "react";
import {
  parseThemeCookie,
  serializeThemeCookie,
  WEB_APP_BACKGROUND,
  type ThemePreference,
} from "@/lib/web-app-theme";

const CHANNEL_NAME = "portal-theme";
const listeners = new Set<() => void>();

/** 서버 layout이 cookie로 그린 `<html data-theme>`이 현재 모드의 기준이다. 없으면 시스템. */
function readPreference(): ThemePreference {
  return parseThemeCookie(document.documentElement.dataset.theme) ?? "system";
}

/** theme-color meta의 media는 그대로 두고 색만 바꾼다. 수동 모드면 모든 meta가 같은 색이 된다. */
function syncThemeColorMeta(preference: ThemePreference) {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute("media") ?? "";
    const dark = preference === "system"
      ? (media.includes("dark") ? true : media.includes("light") ? false : prefersDark)
      : preference === "dark";
    meta.setAttribute("content", dark ? WEB_APP_BACKGROUND.dark : WEB_APP_BACKGROUND.light);
  }
}

function applyToDocument(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  syncThemeColorMeta(preference);
  for (const listener of listeners) listener();
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  // 같은 기기의 다른 탭에서 고른 모드를 바로 따른다(cookie는 이미 공유된다).
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const next = event.data;
    if (next === "system" || next === "light" || next === "dark") applyToDocument(next);
  });
  return channel;
}

/** 고른 모드를 즉시 적용하고 이 기기(cookie)에 저장한 뒤 다른 탭에 알린다. */
export function setThemePreference(preference: ThemePreference) {
  document.cookie = serializeThemeCookie(preference, { secure: window.location.protocol === "https:" });
  applyToDocument(preference);
  getChannel()?.postMessage(preference);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  getChannel();
  return () => { listeners.delete(listener); };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => "system");
}
