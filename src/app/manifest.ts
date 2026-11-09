import type { MetadataRoute } from "next";
import { WEB_APP_BACKGROUND } from "@/lib/web-app-theme";

/**
 * 홈 화면에 추가한 웹앱의 이름·아이콘·시작 화면. iPhone은 홈 화면 앱에서만 웹 푸시를 받으므로
 * `display: standalone`이 알림의 전제다. any 아이콘은 둥근 타일, maskable은 꽉 찬 사각에 마크를 가운데 80%(안전 영역)로 둔다.
 * 아이콘은 src/components/brand/portal-mark.ts 수치로 만든다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Portal - Stann",
    short_name: "Portal",
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
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
