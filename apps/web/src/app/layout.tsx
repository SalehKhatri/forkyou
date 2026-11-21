import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Geist,
  Geist_Mono,
  Geist_Pixel,
  Instrument_Serif,
} from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// Self-hosted by next/font at build time; no request to Google from the browser. Roles: docs/brand.md.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});
// Next has no size metrics for Geist Pixel yet, so it can't build an adjusted fallback (and warns on
// every compile). A plain monospace fallback is close enough for short scores.
const pixel = Geist_Pixel({
  subsets: ["latin"],
  variable: "--font-geist-pixel",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "monospace"],
});
const fontVariables = [sans, mono, display, serif, pixel].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: { default: "ForkYou", template: "%s · ForkYou" },
  description:
    "Every minute in the editor counts. Coding time, streaks and a weekly leaderboard, from your editor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh font-sans">
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
