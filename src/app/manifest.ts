import type { MetadataRoute } from "next";
import { WEB_APP_BACKGROUND } from "@/lib/web-app-theme";

/**
 * 홈 화면에 추가한 웹앱의 이름·아이콘·시작 화면. iPhone은 홈 화면 앱에서만 웹 푸시를 받으므로
 * `display: standalone`이 알림의 전제다. 아이콘은 모서리 없이 꽉 채운 그림이라 maskable로도 쓴다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Stann Lumo DJ 레슨 포탈",
    short_name: "Stann Lumo",
    description: "Stann의 개인 DJ 레슨 일정, 과제·피드백과 연습 기록을 관리하는 포탈입니다.",
    lang: "ko",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: WEB_APP_BACKGROUND.light,
    theme_color: WEB_APP_BACKGROUND.light,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
