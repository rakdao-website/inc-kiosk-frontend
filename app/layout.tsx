import type { Metadata } from "next";
import { Audiowide, Oxanium } from "next/font/google";
import "./globals.css";

// next/font self-hosts these at build time -- no runtime call to
// fonts.googleapis.com, so nothing to silently fail if that CDN is slow,
// blocked, or (as before) miswired via a CSS @import.
const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oxanium",
});

const audiowide = Audiowide({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-audiowide",
});

// Fill mode: stretches the 1080x1920 frame to the exact screen size, X and Y
// independently, so it covers the whole display (the tall kiosk panel, which the
// Mac drives as a landscape display). Controlled by the admin setting "Stretch
// to fill the screen" -- page.tsx caches it in localStorage ("kiosk.stretch") and
// it defaults to on. Off (or ?fit in the URL) keeps 9:16 and centres it.
// Sets --kiosk-sx/--kiosk-sy before the first paint so the frame never
// shows at full size and then shrinks.
const FIT_SCRIPT = `(function(){var d=document.documentElement,v=window.visualViewport,q=/[?&]fit(=1|=true|&|$)/.test(location.search);function f(){var fit=q;try{if(localStorage.getItem("kiosk.stretch")==="0")fit=true;}catch(e){}var w=Math.min(d.clientWidth||1080,v?v.width:1e9,window.innerWidth),h=Math.min(d.clientHeight||1920,v?v.height:1e9,window.innerHeight),sx,sy,H=1920;if(fit){sx=sy=w/1080;H=h/sx;if(H<1920){sx=sy=Math.min(sx,h/1920);H=1920;}}else{sx=w/1080;sy=h/1920;}d.style.setProperty("--kiosk-sx",String(sx));d.style.setProperty("--kiosk-sy",String(sy));d.style.setProperty("--kiosk-h",H+"px");}f();window.addEventListener("resize",f);window.addEventListener("orientationchange",f);window.addEventListener("load",f);document.addEventListener("fullscreenchange",f);if(v)v.addEventListener("resize",f);})();`;

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
    <html className={`${oxanium.variable} ${audiowide.variable}`} lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}