import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// 인증 기반 앱: 정적 생성 없이 모든 페이지를 동적 렌더링으로 처리
export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Stann Lumo - DJ Lesson Portal",
  description:
    "Hypnotic, Futuristic LMS for Stann Lumo's techno mixing masterclass.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${inter.variable} font-sans antialiased bg-background text-foreground`}
      >
        <div className="flex min-h-[100dvh] bg-background text-foreground">
          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </body>
    </html>
  );
}
