import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reactor Panic — the crew decides in secret",
  description: "A real-time multiplayer social strategy game aboard a failing space station.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
