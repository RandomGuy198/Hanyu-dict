import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build, served by `vite preview` on the
 * machine. They are deliberately few and slow-tolerant: the first visit downloads the required
 * data packs (22.18 MB of same-origin files, per the registry's own byte counts) into IndexedDB,
 * which is the real first-run experience and the thing most likely to break on GitHub Pages.
 *
 * Prerequisites (not automated here): `npm ci` and a browser, e.g. `npx playwright install chromium`.
 * The build itself is produced by the webServer command below, so `npm run test:e2e` is a
 * complete, self-contained run.
 */

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // The first test in a context installs the packs from localhost; allow for slow disks.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `--host 127.0.0.1` is not decoration: `vite preview` with no host binds the IPv6 loopback
    // only on Windows, so the readiness poll against the IPv4 URL below never gets an answer and
    // the run dies with "Timed out waiting 300000ms from config.webServer".
    command: `npm run build:only && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
