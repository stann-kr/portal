import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import { WEB_APP_BACKGROUND } from "@/lib/web-app-theme";
import "./globals.css";

// Quiet Ledger 글자: 본문 IBM Plex Sans KR, 시간·숫자 IBM Plex Mono. 빌드 때 받아 자체 호스팅한다.
// 한글은 unicode-range 조각(미리 받기 없음)이라 swap이면 새로고침마다 시스템 한글 글꼴로 먼저 그렸다가 바뀐다.
// block으로 글꼴이 올 때까지(최대 약 3초) 글자를 숨겨 바뀌는 순간을 없앤다. 캐시된 뒤에는 거의 바로 그려진다.
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
    default: "Stann Lumo DJ 레슨 포탈",
    template: "%s | Stann Lumo",
  },
  description: "Stann의 개인 DJ 레슨 일정, 과제·피드백과 연습 기록을 관리하는 포탈입니다.",
  applicationName: "Stann Lumo DJ 레슨 포탈",
  // iPhone 홈 화면에 추가하면 Safari 막대 없이 앱처럼 열린다(웹 푸시의 전제).
  appleWebApp: { capable: true, title: "Stann Lumo", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // 홈 화면 앱의 상단 막대 색.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: WEB_APP_BACKGROUND.light },
    { media: "(prefers-color-scheme: dark)", color: WEB_APP_BACKGROUND.dark },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${plexSans.variable} ${plexMono.variable}`}>
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
      </body>
    </html>
  );
}
