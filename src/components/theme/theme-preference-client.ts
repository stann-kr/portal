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

const THEME_COLOR_MEDIA = {
  light: "(prefers-color-scheme: light)",
  dark: "(prefers-color-scheme: dark)",
} as const;

/**
 * 시스템 모드면 theme-color를 기기 설정별 두 태그(media light/dark)로 둔다. 수동 모드로 연 페이지에는 media 없는
 * 태그 하나뿐이라, 시스템으로 돌아올 때 두 태그를 다시 만들어야 이후 OS 설정 변경을 브라우저가 따라간다.
 * 수동 모드면 남아 있는 모든 태그를 고른 색 하나로 맞춘다.
 */
function syncThemeColorMeta(preference: ThemePreference) {
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  if (preference !== "system") {
    const color = preference === "dark" ? WEB_APP_BACKGROUND.dark : WEB_APP_BACKGROUND.light;
    for (const meta of metas) meta.setAttribute("content", color);
    return;
  }
  for (const meta of metas) {
    if (!meta.getAttribute("media")) meta.remove();
  }
  for (const scheme of ["light", "dark"] as const) {
    const media = THEME_COLOR_MEDIA[scheme];
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="theme-color"][media="${media}"]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.setAttribute("media", media);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", WEB_APP_BACKGROUND[scheme]);
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
