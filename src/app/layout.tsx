import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import { cookies } from "next/headers";
import { parseThemeCookie, THEME_COOKIE, themeColorsFor } from "@/lib/web-app-theme";
import { appleStartupImages } from "@/lib/apple-splash";
import { InputFontAlias } from "@/components/fonts/InputFontAlias";
import { PersistentPlayerHost } from "@/components/player/PersistentPlayerHost";
import { NavigationProgress } from "@/components/app-shell/NavigationProgress";
import { ServiceWorkerNavigation } from "@/components/push/ServiceWorkerNavigation";
import "./globals.css";

// Quiet Ledger 글자: 본문 IBM Plex Sans KR, 시간·숫자 IBM Plex Mono. 빌드 때 받아 자체 호스팅한다.
// 한글은 unicode-range 조각이라 swap이면 새로고침마다 시스템 한글 글꼴로 먼저 그렸다가 바뀐다.
// block으로 글꼴이 올 때까지(최대 약 3초) 글자를 숨겨 바뀌는 순간을 없앤다. 캐시된 뒤에는 거의 바로 그려진다.
// 미리 받기(preload): 400 굵기 한글 조각에는 붙지 않는다. 500·600 굵기 한글 조각에는 next/font가 latin 조각으로
// 잘못 알아 미리 받기 link를 붙인다(2026-11-14 빌드 기준 164개). 줄이려면 preload 옵션이나 글꼴 파일 구성을 바꿔야 한다.
const plexSans = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "block",
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "block",
  variable: "--font-plex-mono",
});

// 인증 기반 앱: 정적 생성 없이 모든 페이지를 동적 렌더링으로 처리
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Portal - Stann",
    template: "%s | Portal - Stann",
  },
  description: "Stann의 개인 DJ 레슨 일정, 과제·피드백과 연습 기록을 관리하는 포탈입니다.",
  applicationName: "Portal - Stann",
  // iPhone 홈 화면에 추가하면 Safari 막대 없이 앱처럼 열린다(웹 푸시의 전제).
  // startupImage: 서버 응답 전(Worker 냉시작 등) 검은 화면 대신 바로 보이는 시작 화면.
  appleWebApp: { capable: true, title: "Portal", statusBarStyle: "default", startupImage: appleStartupImages() },
  // icon.svg·manifest.webmanifest는 public 정적 파일이다. app 파일 규칙(icon.svg, manifest.ts)이면 Worker가
  // 페이지를 열 때마다 만들어 응답해(냉시작이면 수백 ms CPU) 정적 파일로 두고 여기서 링크한다.
  // favicon.ico는 app 파일 규칙이 넣고 정적 파일로 나간다.
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/icons/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

/** 이 기기에서 고른 화면 모드(cookie). 없으면 null(= 시스템). 루트 layout은 이미 force-dynamic이라 정적 생성에 영향이 없다. */
async function readThemeFromRequest() {
  return parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
}

export async function generateViewport(): Promise<Viewport> {
  // 홈 화면 앱의 상단 막대 색. 수동 모드면 그 색 하나, 시스템이면 기기 설정별 두 색.
  // viewportFit cover: iPhone에서 env(safe-area-inset-*)가 실제 값(홈 표시줄 34px 등)을 갖게 한다.
  // 없으면 0이라 하단 미니 플레이어·댓글 입력줄·시트가 홈 표시줄에 붙는다.
  return { themeColor: themeColorsFor(await readThemeFromRequest()), viewportFit: "cover" };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 고른 모드를 첫 HTML부터 그려 다음 접속 때도 다른 모드가 먼저 보이지 않는다(globals.css의 [data-theme]).
  const theme = await readThemeFromRequest();
  return (
    <html
      lang="ko"
      data-theme={theme ?? undefined}
      className={`${plexSans.variable} ${plexMono.variable}`}
    >
      <body
        className="font-sans antialiased bg-background text-foreground"
      >
        <a
          href="#main-content"
          style={{ zIndex: "var(--z-toast)" }}
          className="sr-only fixed left-3 top-3 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only"
        >
          본문으로 건너뛰기
        </a>
        <div className="flex min-h-[100dvh] bg-background text-foreground">
          {/* clip은 스크롤 영역을 만들지 않아 안쪽 sticky(휴대폰 작성 화면 아래 막대)가 화면에 붙는다. */}
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-x-clip">
            {children}
          </main>
        </div>
        {/*
          위쪽 이동 막대. 대시보드↔커뮤니티처럼 다른 layout(각자 AppShell)으로 옮기면 셸 안의 막대는 새로 그려져
          클릭에서 켠 상태를 잃는다. 루트에 한 번만 둔다(useSearchParams라 Suspense).
        */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {/* 알림을 누르면 열린 화면 안에서 앱 이동(public/sw.js가 부탁한다). */}
        <ServiceWorkerNavigation />
        {/* 페이지를 옮겨도 이어지는 하단 미니 플레이어. 레이아웃이 바뀌어도 남도록 루트에 한 번만 둔다. */}
        <PersistentPlayerHost />
        <InputFontAlias />
      </body>
    </html>
  );
}
