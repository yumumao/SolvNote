import { defineConfig, devices } from '@playwright/test';
import { assertIsolatedEnvironment } from './e2e/isolated-environment';

const { origin } = assertIsolatedEnvironment();
export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: [['list'], ['html', { host: '127.0.0.1', open: 'never' }]],
    use: {
        baseURL: origin,
        // Synthetic cookies/credentials must not be retained in trace archives.
        trace: 'off',
        channel: ['chrome', 'msedge'].includes(process.env.SOLVNOTE_E2E_BROWSER_CHANNEL || '') ? process.env.SOLVNOTE_E2E_BROWSER_CHANNEL : undefined,
    },
    webServer: {
        command: process.env.CI
            ? 'node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 4330'
            : 'node node_modules/next/dist/bin/next dev --webpack -H 127.0.0.1 -p 4330',
        url: `${origin}/api/registration/status`,
        reuseExistingServer: false,
        timeout: 180_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
