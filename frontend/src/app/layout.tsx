import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

// Inter for the interface: clear at small sizes and calm at large ones.
const ui = Inter({
  variable: "--font-ui",
  subsets: ["latin"],
});

// Mono is reserved for literal data: verbatim document quotes and part numbers.
const data = JetBrains_Mono({
  variable: "--font-data",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "VAULT", template: "%s | VAULT" },
  description: "Private, local-first document intelligence",
};

export const viewport: Viewport = {
  themeColor: "#101216",
};

// Applies the saved theme before first paint so the page never flashes the wrong colours.
const THEME_SCRIPT = `try{var t=localStorage.getItem("vault-theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${ui.variable} ${data.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
