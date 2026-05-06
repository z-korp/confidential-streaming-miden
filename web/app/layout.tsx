import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confidential Streaming · Miden",
  description:
    "Sablier-style payment streams with private notes (P2IDE) on Miden testnet. Amounts, parties, and unlock schedules stay off-chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
