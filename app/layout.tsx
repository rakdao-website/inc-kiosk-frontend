import type { Metadata } from "next";
import { Audiowide, Noto_Kufi_Arabic, Oxanium } from "next/font/google";
import "./globals.css";

// next/font self-hosts these at build time -- no runtime call to
// fonts.googleapis.com, so nothing to silently fail if that CDN is slow,
// blocked, or (as before) miswired via a CSS @import.
const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oxanium",
});

// Arabic: a modern Kufi typeface that sits well next to Oxanium/Audiowide.
const kufiArabic = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
});

const audiowide = Audiowide({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-audiowide",
});

// Sets --kiosk-scale before the first paint so the 1080x1920 frame never
// shows at full size and then shrinks. React used to measure this after
// hydration, which caused that "big, then fits" jump on load.
const FIT_SCRIPT = `(function(){function f(){var s=Math.min(window.innerWidth/1080,window.innerHeight/1920);document.documentElement.style.setProperty("--kiosk-scale",String(s));}f();window.addEventListener("resize",f);})();`;

export const metadata: Metadata = {
  title: "Innovation City Kiosk",
  description: "Visitor kiosk flow for Innovation City",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={`${oxanium.variable} ${audiowide.variable} ${kufiArabic.variable}`} lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}