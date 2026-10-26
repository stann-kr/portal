import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

// Quiet Ledger 글자: 본문 IBM Plex Sans KR, 시간·숫자 IBM Plex Mono. 빌드 때 받아 자체 호스팅한다.
const plexSans = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plex-mono",
});

// 인증 기반 앱: 정적 생성 없이 모든 페이지를 동적 렌더링으로 처리
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Stann Lumo DJ 레슨 포털",
    template: "%s | Stann Lumo",
  },
  description: "DJ 레슨 일정, 과제·피드백, 커리큘럼과 연습 기록을 관리하는 학생·강사 포털입니다.",
  applicationName: "Stann Lumo DJ 레슨 포털",
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
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-x-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
