import "./globals.css";
import type { Metadata } from "next";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "TzDeck",
  description: "OBJKT booster packs and deck",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}