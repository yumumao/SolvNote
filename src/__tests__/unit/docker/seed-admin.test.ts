import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

type SeedEnv = Record<string, string | undefined>;
type User = {
    id: string;
    email: string;
    password: string;
    role: string;
    isActive: boolean;
    educationStage: string | null;
    enrollmentYear: number | null;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const initialPassword = ['synthetic', 'bootstrap', 'only'].join('-');
const initialEmail = 'bootstrap@example.invalid';
const defaultEmail = 'admin@localhost';
const storedHash = 'synthetic-stored-hash';

// Execute only the named source with an allowlisted mock module loader. Neither
// entry point can import the real Prisma client, application config or .env.
function evaluateSource(
    path: string,
    modules: Record<string, unknown>,
    globals: Record<string, unknown>,
    isEntry = true,
) {
    const module = { exports: {} as Record<string, unknown> };
    const require = Object.assign((name: string) => {
        if (!Object.prototype.hasOwnProperty.call(modules, name)) {
            throw new Error(`Unexpected dependency in isolated test: ${name}`);
        }
        return modules[name];
    }, { main: isEntry ? module : undefined });
    const source = readFileSync(resolve(root, path), 'utf8');
    const code = path.endsWith('.ts') ? transpileModule(source, {
        compilerOptions: {
            module: ModuleKind.CommonJS,
            target: ScriptTarget.ES2022,
            esModuleInterop: true,
        },
        fileName: path,
    }).outputText : source;
    runInNewContext(code, { module, exports: module.exports, require, ...globals }, {
        filename: path,
    });
    return module.exports;
}

function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: 'synthetic-user-id',
        email: defaultEmail,
        password: storedHash,
        role: 'admin',
        isActive: true,
        educationStage: null,
        enrollmentYear: null,
        ...overrides,
    };
}

function dependencies(admin: User | null = null, sameEmailUser: User | null = null) {
    return {
        prisma: {
            user: {
                findFirst: vi.fn().mockResolvedValue(admin),
                findUnique: vi.fn().mockResolvedValue(sameEmailUser),
                create: vi.fn().mockImplementation(async ({ data }: {
                    data: Record<string, unknown>;
                }) => ({ id: 'synthetic-created-id', ...data })),
                update: vi.fn(),
                updateMany: vi.fn(),
                upsert: vi.fn(),
            },
            $disconnect: vi.fn().mockResolvedValue(undefined),
        },
        hash: vi.fn().mockResolvedValue(storedHash),
    };
}

type Dependencies = ReturnType<typeof dependencies>;

function expectNoChanges(deps: Dependencies) {
    expect(deps.hash).not.toHaveBeenCalled();
    expect(deps.prisma.user.create).not.toHaveBeenCalled();
    expect(deps.prisma.user.update).not.toHaveBeenCalled();
    expect(deps.prisma.user.updateMany).not.toHaveBeenCalled();
    expect(deps.prisma.user.upsert).not.toHaveBeenCalled();
}

async function runSeed(path: string, deps: Dependencies, env: SeedEnv = {}, constructorError?: Error) {
    const console = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const process = {
        env: { ...env },
        exitCode: 0,
        exit: vi.fn((code: number) => { process.exitCode = code; }),
    };
    const PrismaClient = vi.fn(function () {
        if (constructorError) throw constructorError;
        return deps.prisma;
    });
    evaluateSource(path, {
        '@prisma/client': { PrismaClient },
        bcryptjs: { hash: deps.hash },
    }, { console, process });
    // All dependencies resolve in memory. Drain the entry point's promise chain
    // without running a real seed process, reading config or opening a database.
    await new Promise<void>((done) => setImmediate(done));
    const output = Object.values(console).flatMap((fn) =>
        fn.mock.calls.map((args) => format(...args)),
    ).join('\n');
    return { exitCode: process.exitCode, output };
}

function expectNoCredentials(output: string, env: SeedEnv = {}, emails: string[] = []) {
    for (const value of [defaultEmail, initialEmail, initialPassword, storedHash,
        env.INITIAL_ADMIN_PASSWORD, env.INITIAL_ADMIN_EMAIL, ...emails]) {
        if (value) expect(output.includes(value)).toBe(false);
    }
}

describe.each(['scripts/seed-admin.js', 'prisma/seed.ts'])('%s isolated bootstrap', (path) => {
    it('creates a first administrator with the supplied password and new-user education defaults', async () => {
        const deps = dependencies();
        const env = { INITIAL_ADMIN_PASSWORD: initialPassword };
        const result = await runSeed(path, deps, env);

        expect(result.exitCode).toBe(0);
        expect(deps.prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { role: 'admin' },
        }));
        expect(deps.hash).toHaveBeenCalledExactlyOnceWith(initialPassword, 12);
        expect(deps.prisma.user.create).toHaveBeenCalledExactlyOnceWith({
            data: {
                email: defaultEmail,
                password: storedHash,
                name: 'Admin',
                role: 'admin',
                isActive: true,
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            },
        });
        expect(deps.prisma.user.update).not.toHaveBeenCalled();
        expect(deps.prisma.$disconnect).toHaveBeenCalledOnce();
        expectNoCredentials(result.output, env);
    });

    it('accepts an optional initial email without logging it', async () => {
        const deps = dependencies();
        const env = { INITIAL_ADMIN_EMAIL: initialEmail, INITIAL_ADMIN_PASSWORD: initialPassword };
        const result = await runSeed(path, deps, env);

        expect(result.exitCode).toBe(0);
        expect(deps.prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { email: initialEmail },
        }));
        expect(deps.prisma.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ email: initialEmail, password: storedHash }),
        });
        expectNoCredentials(result.output, env);
    });

    it('accepts the twelve-character boundary without altering the password', async () => {
        const deps = dependencies();
        const env = { INITIAL_ADMIN_PASSWORD: 'synthetic-12' };
        const result = await runSeed(path, deps, env);
        expect(env.INITIAL_ADMIN_PASSWORD).toHaveLength(12);
        expect(result.exitCode).toBe(0);
        expect(deps.hash).toHaveBeenCalledExactlyOnceWith(env.INITIAL_ADMIN_PASSWORD, 12);
        expectNoCredentials(result.output, env);
    });

    it.each([
        ['missing', undefined],
        ['empty', ''],
        ['short', 'short'],
        ['eleven-character', 'x'.repeat(11)],
        ['whitespace-only', ' '.repeat(24)],
    ])('fails closed for a %s password with configuration guidance', async (_label, password) => {
        const deps = dependencies();
        const env = { INITIAL_ADMIN_PASSWORD: password };
        const result = await runSeed(path, deps, env);

        expect(result.exitCode).toBe(1);
        expectNoChanges(deps);
        expect(result.output).toContain('INITIAL_ADMIN_PASSWORD');
        expect(result.output).toContain('12');
        expect(deps.prisma.$disconnect).toHaveBeenCalledOnce();
        expectNoCredentials(result.output, env);
    });

    it.each([
        ['default active administrator', defaultEmail, true, undefined],
        ['default disabled administrator', defaultEmail, false, undefined],
        ['different active administrator', 'existing@example.invalid', true, initialPassword],
        ['different disabled administrator', 'existing@example.invalid', false, initialPassword],
        ['administrator with stale weak bootstrap environment', defaultEmail, true, 'short'],
    ] as const)('leaves a %s unchanged, including missing education fields', async (_label, email, isActive, password) => {
        const admin = makeUser({ email, isActive });
        const before = { ...admin };
        const deps = dependencies(admin, admin);
        const env = { INITIAL_ADMIN_EMAIL: initialEmail, INITIAL_ADMIN_PASSWORD: password };
        const result = await runSeed(path, deps, env);

        expect(result.exitCode).toBe(0);
        expect(deps.prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { role: 'admin' },
        }));
        expect(deps.prisma.user.findUnique).not.toHaveBeenCalled();
        expectNoChanges(deps);
        expect(admin).toEqual(before);
        expectNoCredentials(result.output, env, [email]);
    });

    it.each([true, false])('refuses to promote or reactivate an ordinary same-email account (active: %s)', async (isActive) => {
        const user = makeUser({ email: initialEmail, role: 'user', isActive });
        const before = { ...user };
        const deps = dependencies(null, user);
        const env = { INITIAL_ADMIN_EMAIL: initialEmail, INITIAL_ADMIN_PASSWORD: initialPassword };
        const result = await runSeed(path, deps, env);

        expect(result.exitCode).toBe(1);
        expectNoChanges(deps);
        expect(user).toEqual(before);
        expectNoCredentials(result.output, env);
    });

    it.each(['findFirst', 'findUnique', 'hash', 'create', 'disconnect'] as const)(
        'fails closed and redacts a sensitive %s error', async (operation) => {
            const deps = dependencies();
            const env = { INITIAL_ADMIN_EMAIL: initialEmail, INITIAL_ADMIN_PASSWORD: initialPassword };
            const error = new Error(`Synthetic failure: ${initialEmail} ${initialPassword} ${storedHash}`);
            const target = operation === 'hash' ? deps.hash
                : operation === 'disconnect' ? deps.prisma.$disconnect
                    : deps.prisma.user[operation];
            target.mockRejectedValueOnce(error);
            const result = await runSeed(path, deps, env);

            expect(result.exitCode).toBe(1);
            if (operation === 'findFirst' || operation === 'findUnique') expectNoChanges(deps);
            expectNoCredentials(result.output, env);
        },
    );

    it('redacts client-construction failures before any database call', async () => {
        const deps = dependencies();
        const error = new Error(`Synthetic constructor failure: ${initialEmail} ${initialPassword}`);
        const result = await runSeed(path, deps, {}, error);
        expect(result.exitCode).toBe(1);
        expectNoChanges(deps);
        expectNoCredentials(result.output);
    });
});

describe('seed-admin injectable helper', () => {
    it('does not initialize a client on import or expose a fixed default password', async () => {
        const deps = dependencies();
        const PrismaClient = vi.fn();
        const exports = evaluateSource('scripts/seed-admin.js', {
            '@prisma/client': { PrismaClient }, bcryptjs: { hash: deps.hash },
        }, { process: { env: {} }, console: {} }, false);
        const seedAdmin = exports.seedAdmin as (args: Dependencies & { env: SeedEnv }) => Promise<unknown>;

        expect(exports.DEFAULT_ADMIN).not.toHaveProperty('password');
        await expect(seedAdmin({ ...deps, env: {} })).rejects.toThrow('INITIAL_ADMIN_PASSWORD');
        expect(PrismaClient).not.toHaveBeenCalled();
        expectNoChanges(deps);
    });
});

function loadAuth() {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const prisma = { user: { findUnique: vi.fn() } };
    const compare = vi.fn().mockResolvedValue(true);
    const exports = evaluateSource('src/lib/auth.ts', {
        '@next-auth/prisma-adapter': { PrismaAdapter: vi.fn() },
        'next-auth/providers/credentials': (options: unknown) => options,
        '@/lib/prisma': { prisma },
        bcryptjs: { compare },
        '@/lib/logger': { createLogger: () => logger },
    }, { process: { env: { NODE_ENV: 'production' } } });
    const options = exports.authOptions as {
        debug: boolean;
        providers: { authorize: (credentials?: { email: string; password: string }) => Promise<unknown> }[];
        logger: { error: (code: string, metadata: unknown) => void; debug: (code: string, metadata: unknown) => void };
    };
    return { options, logger, prisma, compare };
}

describe('authentication logging only', () => {
    it('disables production debug and omits sensitive provider metadata', () => {
        const { options, logger } = loadAuth();
        expect(options.debug).toBe(false);
        const metadata = { email: initialEmail, password: initialPassword };
        options.logger.debug('SYNTHETIC_DEBUG', metadata);
        options.logger.error('SYNTHETIC_ERROR', metadata);
        const output = Object.values(logger).flatMap((fn) => fn.mock.calls.map((args) => format(...args))).join('\n');
        expectNoCredentials(output);
    });

    it('keeps successful authorization unchanged without logging credentials or user email', async () => {
        const { options, logger, prisma, compare } = loadAuth();
        const user = { ...makeUser({ email: initialEmail }), name: 'Synthetic Admin' };
        prisma.user.findUnique.mockResolvedValue(user);
        const result = await options.providers[0].authorize({ email: initialEmail, password: initialPassword });

        expect(prisma.user.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { email: initialEmail } });
        expect(compare).toHaveBeenCalledExactlyOnceWith(initialPassword, storedHash);
        expect(result).toEqual({ id: user.id, email: user.email, name: user.name, role: user.role });
        const output = Object.values(logger).flatMap((fn) => fn.mock.calls.map((args) => format(...args))).join('\n');
        expectNoCredentials(output);
    });

    it('still rejects missing credentials without a lookup', async () => {
        const { options, prisma } = loadAuth();
        await expect(options.providers[0].authorize()).resolves.toBeNull();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('still rejects an unknown user', async () => {
        const { options, prisma, compare } = loadAuth();
        prisma.user.findUnique.mockResolvedValue(null);
        await expect(options.providers[0].authorize({ email: initialEmail, password: initialPassword })).resolves.toBeNull();
        expect(compare).not.toHaveBeenCalled();
    });

    it('still rejects a disabled account without comparing its password', async () => {
        const { options, prisma, compare } = loadAuth();
        prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));
        await expect(options.providers[0].authorize({ email: initialEmail, password: initialPassword })).rejects.toThrow('Account is disabled');
        expect(compare).not.toHaveBeenCalled();
    });

    it('still rejects an invalid password', async () => {
        const { options, prisma, compare } = loadAuth();
        prisma.user.findUnique.mockResolvedValue(makeUser());
        compare.mockResolvedValue(false);
        await expect(options.providers[0].authorize({ email: initialEmail, password: initialPassword })).resolves.toBeNull();
    });
});
