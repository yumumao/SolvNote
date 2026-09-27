import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const E2E_ORIGIN = 'http://127.0.0.1:4330';

/** Fail BEFORE constructing Prisma or starting Next. Never accept a normal app DB. */
export function assertIsolatedEnvironment(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
    const fail = (): never => { throw new Error('E2E isolation required: use node e2e/run-isolated.mjs or the disposable CI E2E job'); };
    if (env.SOLVNOTE_E2E_ISOLATED !== '1' || env.NEXTAUTH_URL !== E2E_ORIGIN) fail();
    if (!env.NEXTAUTH_SECRET?.startsWith('e2e-only-') || env.NEXTAUTH_SECRET.length < 32) fail();
    if (!env.INITIAL_ADMIN_PASSWORD?.startsWith('e2e-only-') || env.INITIAL_ADMIN_PASSWORD.length < 15) fail();
    if (env.AI_WORKER_DISABLED !== '1' || env.SOLVNOTE_ENABLE_AI_CONFIG_EXPORT !== 'false') fail();
    if (!env.AI_CONFIG_MASTER_KEY || Buffer.from(env.AI_CONFIG_MASTER_KEY, 'base64').length !== 32) fail();
    if (env.SOLVNOTE_TURNSTILE_SITE_KEY || env.SOLVNOTE_TURNSTILE_SECRET_KEY) fail();
    const root = env.SOLVNOTE_E2E_TEMP_DIR;
    const raw = env.DATABASE_URL;
    if (!root || !path.isAbsolute(root) || !raw?.startsWith('file:')) fail();
    const directory = realpathSync(root!);
    const temporaryRoots = env.GITHUB_ACTIONS === 'true' && env.RUNNER_TEMP ? [env.RUNNER_TEMP] : [
        tmpdir(), ...(process.platform === 'win32' && env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Temp')] : []),
    ];
    if (!temporaryRoots.some(root => {
        if (!existsSync(root)) return false;
        const relative = path.relative(realpathSync(root), directory);
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    })) fail();
    // Local runs MUST use a disposable source copy; CI checkout is already isolated.
    const local = path.relative(directory, realpathSync(cwd));
    if (env.GITHUB_ACTIONS !== 'true' && (local.startsWith('..') || path.isAbsolute(local))) fail();
    const databasePath = raw!.slice(5);
    if (!path.isAbsolute(databasePath) || /[?#]/.test(databasePath)) fail();
    if (path.resolve(path.dirname(databasePath)) !== path.resolve(directory) || !/^solvnote-e2e-[a-z0-9-]+\.db$/i.test(path.basename(databasePath))) fail();
    if (existsSync(databasePath) && (lstatSync(databasePath).isSymbolicLink() || realpathSync(databasePath) !== path.resolve(databasePath))) fail();
    // Next and Prisma implicitly load these files. Refuse them without opening them.
    const files = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local', 'prisma/.env', 'config/app-config.json', 'config/ai-master.key'];
    if (files.some(file => existsSync(path.join(cwd, file)))) fail();
    return { databaseUrl: raw!, secret: env.NEXTAUTH_SECRET!, origin: E2E_ORIGIN };
}
