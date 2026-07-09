import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
