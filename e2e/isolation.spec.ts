import { test, expect } from '@playwright/test';
import { assertIsolatedEnvironment } from './isolated-environment';

test('E2E fixture accepts only an explicit disposable environment', () => {
    expect(() => assertIsolatedEnvironment()).not.toThrow();
});

for (const [name, patch] of Object.entries({
    'no explicit opt-in': { SOLVNOTE_E2E_ISOLATED: undefined },
    'normal application port': { NEXTAUTH_URL: 'http://127.0.0.1:3000' },
    'another agent port': { NEXTAUTH_URL: 'http://127.0.0.1:4329' },
    'relative SQLite database': { DATABASE_URL: 'file:./e2e.db' },
    'network database': { DATABASE_URL: 'postgresql://example.invalid/database' },
    'ordinary database filename': { DATABASE_URL: `file:${process.env.SOLVNOTE_E2E_TEMP_DIR}/production.db` },
    'database outside temporary directory': { DATABASE_URL: 'file:/production/solvnote-e2e-forbidden.db' },
    'non-test session signing secret': { NEXTAUTH_SECRET: 'not-an-e2e-fixture' },
    'live Turnstile configuration': { SOLVNOTE_TURNSTILE_SECRET_KEY: 'must-never-be-used' },
    'enabled AI worker': { AI_WORKER_DISABLED: undefined },
    'enabled secret export': { SOLVNOTE_ENABLE_AI_CONFIG_EXPORT: 'true' },
    'missing synthetic vault key': { AI_CONFIG_MASTER_KEY: undefined },
})) {
    test(`E2E fixture refuses ${name} before opening Prisma`, () => {
        expect(() => assertIsolatedEnvironment({ ...process.env, ...patch })).toThrow(/E2E isolation required/);
    });
}
