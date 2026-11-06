/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const PRIVATE_DATA_DIR = fileURLToPath(new URL('../Hanyu data', import.meta.url));
const BRIDGE_PREFIXES = ['/__local_private_data__/', '/__private_data__/'];

function mimeForExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

function localPrivateDataBridge(): Plugin {
  const handler = (
    req: { url?: string; method?: string },
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: Buffer | string) => void },
    next: () => void,
  ) => {
    const rawUrl = req.url ?? '';
    const pathname = rawUrl.split('?')[0] ?? '';
    const prefix = BRIDGE_PREFIXES.find((p) => pathname.startsWith(p));
    if (!prefix) {
      next();
      return;
    }
    const rel = decodeURIComponent(pathname.slice(prefix.length)).replace(/^\/+/, '');
    if (!rel || rel.includes('..') || rel.startsWith('.')) {
      res.statusCode = 400;
      res.end('Invalid path');
      return;
    }
    const resolved = path.resolve(PRIVATE_DATA_DIR, rel);
    if (!resolved.startsWith(path.resolve(PRIVATE_DATA_DIR)) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeForExt(resolved));
    res.setHeader('Cache-Control', 'no-cache');
    res.end(fs.readFileSync(resolved));
  };
  return {
    name: 'hanyu:local-private-data-bridge',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/**
 * GitHub Pages serves the site under /<repo>/ and cannot send response headers, so the
 * Content-Security-Policy is injected as a <meta> tag during the production build only
 * (dev-mode HMR needs the inline bootstrap that this policy forbids).
 */
function cspForProduction(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://api.github.com data: blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    name: 'hanyu:csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<title>',
        `<meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <title>`,
      );
    },
  };
}

export default defineConfig({
  // Relative base keeps the build working under any repository name on GitHub Pages.
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    localPrivateDataBridge(),
    cspForProduction(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: false, // supplied by public/manifest.webmanifest so the file is reviewable
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'licenses/**/*.{txt,md}'],
        // Nothing under data/ is ever precached: packs are installed into IndexedDB with hash
        // verification, so the service worker must not push any of them to the device.
        globIgnores: ['**/data/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            // The pack registry is small and must be re-checkable; packs themselves are
            // installed into IndexedDB with hash verification, never precached.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/manifest.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pack-manifest',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          db: ['dexie'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] },
  },
});
