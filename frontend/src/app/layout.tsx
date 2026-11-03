import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

// F10.21: Archivo, a grotesque with a width axis. Normal width for reading; widened for titles and the wordmark, like
// the lettering in a drawing's title block.
const ui = Archivo({
  variable: "--font-ui",
  subsets: ["latin"],
  axes: ["wdth"],
});

// Mono is reserved for literal data: verbatim document quotes, part numbers and measured values.
const data = IBM_Plex_Mono({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "VAULT", template: "%s | VAULT" },
  description: "Private, local-first document intelligence",
};

export const viewport: Viewport = {
  themeColor: "#000000",
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
