import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "@/components/chrome/site-header";
import { SiteFooter } from "@/components/chrome/site-footer";
import { ICON_PATH } from "@/lib/icon";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "vibers.tv — a wall of live coding streams",
    template: "%s · vibers.tv",
  },
  description:
    "Put YouTube live coding streams on a wall, watch them side by side, and open the one you want.",
  // The favicon is not a file in this build any more — it is a row in Neon that
  // an admin changes from `/admin`, and this is the one URL that serves it. It
  // carries no version on purpose: a versioned URL would mean reading the
  // database to render every page. `/api/icon` answers with an `ETag` instead,
  // and falls back to the shipped `public/icon.png` when nothing is up.
  icons: { icon: ICON_PATH },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${jetbrains.variable}`}>
      <head>
        {/* Every picture on this site comes from YouTube, so the handshakes
            are worth paying for up front. `s.ytimg.com` is the one that
            matters most and is easiest to forget: the embed's own script and
            CSS bundle come from there and sit directly on the critical path,
            ahead of the first video byte. Deliberately *not* here:
            googlevideo.com, whose media hosts are per-request
            (rr3---sn-….googlevideo.com), so an apex preconnect buys nothing. */}
        <link rel="preconnect" href="https://s.ytimg.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />
      </head>
      <body className="min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-amber focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-ink"
        >
          Skip to content
        </a>
        <div className="relative z-10 flex min-h-screen flex-col">
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
