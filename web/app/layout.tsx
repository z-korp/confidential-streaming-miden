import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confidential Streaming on Miden",
  description: "Sablier-style streams with private notes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
