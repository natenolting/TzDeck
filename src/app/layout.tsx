import "./globals.css";
import type { Metadata } from "next";
import { Inter, Oxanium } from "next/font/google";
import { WalletProvider } from "@/context/WalletContext";
import { SITE_ORIGIN } from "@/lib/share";
import { Analytics } from "@vercel/analytics/next";

const SITE_DESCRIPTION =
  "Battle other collectors with art from your Tezos collection.";

// Oxanium is the brand face and carries the titles. Both are variable fonts,
// so the weight axis loads whole rather than pinned -- pinning one weight left
// the browser synthesising the semibold and bold the UI actually uses.
const displayFont = Oxanium({
  subsets: ["latin"],
  variable: "--font-oxanium",
});

const textFont = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  // Every route below here can now name its images and canonical URL with a
  // relative path. Without it a shared link unfurls as bare text, which is
  // what every TzDeck link did until this landed.
  metadataBase: new URL(SITE_ORIGIN),
  title: "TzDeck",
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "TzDeck",
    title: "TzDeck",
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  // The site now has its own card image, from src/app/opengraph-image.tsx, which
  // every route inherits unless it ships one of its own.
  twitter: {
    card: "summary_large_image",
    title: "TzDeck",
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/favicon-180x180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${displayFont.variable} ${textFont.variable}`}>
      <body>
        <WalletProvider>{children}</WalletProvider>
        <Analytics />
      </body>
    </html>
  );
}
