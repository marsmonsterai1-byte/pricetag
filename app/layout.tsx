import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOGOSA - 사기 전에, 3초만",
  description: "매장에서 본 상품, 온라인 최저가 3초 만에 확인하세요",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BOGOSA",
  },
};

export const viewport: Viewport = {
  themeColor: "#4493FF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css"
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
