import { randomUUID } from 'node:crypto';
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { encode } from 'next-auth/jwt';
import { hash } from 'bcryptjs';
import { assertIsolatedEnvironment } from './isolated-environment';

type Fixtures = {
    db: PrismaClient;
    member: { id: string; email: string };
    signInAs: (userId?: string, context?: BrowserContext) => Promise<void>;
    isolated: void;
};

export const test = base.extend<Fixtures>({
    isolated: [async ({ baseURL }, runFixture) => {
        const { origin } = assertIsolatedEnvironment();
        expect(baseURL).toBe(origin);
        await runFixture();
    }, { auto: true }],
    db: async ({ baseURL }, runFixture) => {
        const { databaseUrl, origin } = assertIsolatedEnvironment();
        expect(baseURL).toBe(origin);
        const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
        try { await runFixture(db); } finally { await db.$disconnect(); }
    },
    member: async ({ db }, runFixture) => {
        // Test-owned member, never a seeded real account. No production auth entry point.
        const member = await db.user.create({
            data: { email: `e2e-${randomUUID()}@example.invalid`, name: 'E2E member', role: 'user',
                password: await hash(process.env.INITIAL_ADMIN_PASSWORD!, 4), aiAccessInitialized: true },
            select: { id: true, email: true },
        });
        await runFixture(member);
    },
    signInAs: async ({ db, context }, runFixture) => {
        await runFixture(async (userId, target = context) => {
            const { secret, origin } = assertIsolatedEnvironment();
            const user = await db.user.findUniqueOrThrow({
                where: userId ? { id: userId } : { email: process.env.INITIAL_ADMIN_EMAIL || 'admin@localhost' },
                select: { id: true, email: true, name: true, role: true, sessionVersion: true, mustChangePassword: true, isActive: true, expiresAt: true },
            });
            if (!user.isActive || (user.expiresAt && user.expiresAt <= new Date())) throw new Error('E2E fixture account unavailable');
            const token = await encode({ secret, maxAge: 3600, token: {
                sub: user.id, id: user.id, email: user.email, name: user.name, role: user.role,
                sessionVersion: user.sessionVersion, mustChangePassword: user.mustChangePassword,
            } });
            await target.addCookies([{ name: 'next-auth.session-token', value: token, url: origin, httpOnly: true, sameSite: 'Lax', secure: false }]);
        });
    },
});
export { expect };
