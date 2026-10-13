import { execSync } from 'node:child_process';

// Versionskennung des Builds (Commit) – Cloudflare Workers Builds setzt WORKERS_CI_COMMIT_SHA, sonst aus git.
// Öffentlich unter /api/version (das Repository ist öffentlich, die Kennung verrät nichts Zusätzliches).
const buildCommit = (() => {
  if (process.env.WORKERS_CI_COMMIT_SHA) return process.env.WORKERS_CI_COMMIT_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: { EK_BUILD_COMMIT: buildCommit, EK_BUILD_AT: new Date().toISOString() },
  // Für den Cloudflare-Worker (OpenNext baut darauf auf, siehe scripts/cf-postbuild.mjs)
  output: 'standalone',
  // Lokale Datenbank und lokale Uploads (Ausweise!) nie in Build-Ausgaben kopieren – die Dateiverfolgung würde
  // ./data sonst mitnehmen, weil der Code zur Laufzeit dort liest. Schlüssel bewusst '/**' (nur Seiten/Routen,
  // dort löst Next die Muster absolut auf). '*' gälte auch für next-server, wo Next die Muster als Teilstring
  // prüft – './data/**' träfe dann auch next/dist/lib/metadata/… und der Worker-Build bricht ab.
  outputFileTracingExcludes: { '/**': ['./data/**/*', './.wrangler/**/*', './.dev.vars', './.env*'] },
  // Uploads laufen über die eigene Route (multipart); Grenze hier großzügig, die Route prüft selbst.
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};
export default nextConfig;
