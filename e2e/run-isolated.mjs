/**
 * Local-only disposable runner: node e2e/run-isolated.mjs [Playwright arguments]
 * Never launches the shared tree, reads .env/config, or inherits application secrets.
 * Temporary test DB/artifacts are retained for inspection; Playwright owns server cleanup.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Windows junctions need NTFS; Next's webpack entries also need the dependency drive.
const temporaryBase = process.platform === 'win32' ? path.join(path.parse(source).root, 'Temp') : tmpdir();
mkdirSync(temporaryBase, { recursive: true });
const root = mkdtempSync(path.join(temporaryBase, 'solvnote-e2e-'));
const app = path.join(root, 'app');
mkdirSync(app);
// Explicit source allowlist: no .env, config, data, existing .next, or Prisma DB files.
for (const entry of ['src', 'public', 'e2e', 'docs/templates', 'package.json', 'package-lock.json',
    'next.config.ts', 'next-env.d.ts', 'tsconfig.json', 'postcss.config.mjs', 'playwright.config.ts',
    'prisma/schema.prisma', 'prisma/seed.ts']) {
    if (existsSync(path.join(source, entry))) cpSync(path.join(source, entry), path.join(app, entry), { recursive: true, dereference: false });
}
symlinkSync(path.join(source, 'node_modules'), path.join(app, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
// Only OS/browser/tool runtime variables are inherited. All application variables are synthetic.
const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PLAYWRIGHT_BROWSERS_PATH)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
Object.assign(env, {
    TEMP: temporaryBase, TMP: temporaryBase,
    SOLVNOTE_E2E_ISOLATED: '1', SOLVNOTE_E2E_TEMP_DIR: root,
    DATABASE_URL: `file:${path.join(root, 'solvnote-e2e-local.db').replaceAll('\\', '/')}`,
    INITIAL_ADMIN_EMAIL: 'admin@localhost', INITIAL_ADMIN_PASSWORD: `e2e-only-${randomBytes(24).toString('hex')}`,
    NEXTAUTH_SECRET: `e2e-only-${randomBytes(32).toString('hex')}`, NEXTAUTH_URL: 'http://127.0.0.1:4330',
    AI_WORKER_DISABLED: '1', AI_CONFIG_MASTER_KEY: randomBytes(32).toString('base64'),
    SOLVNOTE_ENABLE_AI_CONFIG_EXPORT: 'false', SOLVNOTE_TURNSTILE_SITE_KEY: '', SOLVNOTE_TURNSTILE_SECRET_KEY: '',
    NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_HTML_OPEN: 'never', NO_PROXY: '127.0.0.1,localhost',
});
const require = createRequire(path.join(source, 'package.json'));
if (!existsSync(require('@playwright/test').chromium.executablePath())) {
    if (process.platform === 'win32' && existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')) env.SOLVNOTE_E2E_BROWSER_CHANNEL = 'chrome';
    else if (process.platform === 'win32' && existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')) env.SOLVNOTE_E2E_BROWSER_CHANNEL = 'msedge';
    else throw new Error('Install the Playwright Chromium browser before running isolated E2E');
}
// Read-only reproduction info; no credentials/cookies are written.
writeFileSync(path.join(root, 'README.txt'), 'Disposable E2E source/SQLite/artifacts. Port 4330 only. Session secrets exist only in runner memory.\n');
console.log(`E2E disposable artifacts: ${root}`);

async function assertPortAvailable() {
    await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', () => reject(new Error('Port 4330 is already occupied; refusing to reuse or stop another server')));
        server.listen(4330, '127.0.0.1', () => server.close(resolve));
    });
}
async function run(script, args) {
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(app, 'node_modules', script), ...args], { cwd: app, env, stdio: 'inherit', windowsHide: true });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Isolated command failed (exit ${code})`)));
    });
}
try {
    await assertPortAvailable();
    await run('prisma/build/index.js', ['db', 'push', '--skip-generate']);
    await run('ts-node/dist/bin.js', ['--compiler-options', '{"module":"CommonJS"}', 'prisma/seed.ts']);
    await run('@playwright/test/cli.js', ['test', ...process.argv.slice(2)]);
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Isolated E2E failed');
    process.exitCode = 1;
} finally {
    // Playwright terminates its process group (including Next) even on test failures.
    // Verify it rather than blindly killing any process that happens to own this port.
    try { await assertPortAvailable(); console.log('Port 4330 released; no E2E server remains.'); }
    catch { console.error('Port 4330 is still occupied; check only this run\'s child processes.'); process.exitCode = 1; }
}
