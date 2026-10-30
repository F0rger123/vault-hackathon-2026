import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
// The browser talks to the VAULT API directly, so its origin must be allowed for fetch and images.
const apiOrigin = new URL(process.env.NEXT_PUBLIC_VAULT_API || "http://127.0.0.1:8000").origin;
// F12.12: the installed app is static files served by the API itself, so the browser needs one origin only.
// Those responses get their headers from backend/ui.py; keep the two lists in step.
const staticExport = process.env.VAULT_STATIC_EXPORT === "1";

// No nonces: the app is a local tool, and nonces would force every page to render dynamically.
// No upgrade-insecure-requests: the local API is plain http on 127.0.0.1.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${apiOrigin}`,
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  poweredByHeader: false,
  ...(staticExport
    ? {
        output: "export" as const,
        // Empty means same origin. Set here because an empty environment variable does not survive PowerShell.
        env: { NEXT_PUBLIC_VAULT_API: "" },
      }
    : {
        cacheComponents: true,
        // The browser tests build into their own folder so they never overwrite a developer's build.
        distDir: process.env.VAULT_NEXT_DIST_DIR ?? ".next",
        partialPrefetching: true,
        async headers() {
          return [{ source: "/(.*)", headers: securityHeaders }];
        },
      }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
