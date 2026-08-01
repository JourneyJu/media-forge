import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediaForge",
  description: "AI WeChat article generation and layout platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

