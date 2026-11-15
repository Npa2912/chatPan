import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
export const metadata: Metadata = {
  title: "chatPan — Your Personal AI Universe",
  description:
    "Không gian AI của riêng bạn. Trò chuyện, sáng tạo và khám phá cùng chatPan.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
