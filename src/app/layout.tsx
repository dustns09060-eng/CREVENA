import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// STEP45: "인플루언서 업무 자동화 프로그램" is what shows in search results
// and link previews. "업무 자동화" oversells a tool that prepares content but
// never posts it anywhere — narrowed to what CREVENA actually does. Page-level
// metadata (landing, /terms, /privacy, ...) overrides the title via the
// template below.
export const metadata: Metadata = {
  title: {
    default: "CREVENA — 협찬 콘텐츠 제작 도구",
    template: "%s | CREVENA",
  },
  description: "크리에이터를 위한 협찬 콘텐츠 제작 도구. 가이드와 사진을 넣으면 채널별 콘텐츠 초안을 만들어 드려요.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
