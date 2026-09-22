import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const INITIAL_ADMIN_GUIDANCE = 'For a new installation, set INITIAL_ADMIN_PASSWORD to a non-blank value of at least 12 characters and optionally set INITIAL_ADMIN_EMAIL. Resolve any existing non-admin account conflict manually.';

async function main() {
    const prisma = new PrismaClient();

    try {
        // Disabled administrators also prevent bootstrap from changing accounts.
        const existingAdmin = await prisma.user.findFirst({
            where: { role: 'admin' },
            select: { id: true },
        });
        if (existingAdmin) {
            console.log('An administrator already exists. No changes made.');
            return;
        }

        const password = process.env.INITIAL_ADMIN_PASSWORD;
        if (!password || password.length < 12 || !password.trim()) {
            throw new Error(INITIAL_ADMIN_GUIDANCE);
        }
        const email = process.env.INITIAL_ADMIN_EMAIL?.trim() || 'admin@localhost';
        const existingUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
        });
        if (existingUser) {
            throw new Error('Initial administrator bootstrap refused: the selected account already exists. Resolve the account conflict manually; no permissions were changed.');
        }

        const hashedPassword = await hash(password, 12);
        await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name: 'Admin',
                role: 'admin',
                isActive: true,
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            },
        });

        console.log('Success! Admin user created.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(() => {
    // Never print raw errors: their messages can contain credentials or email.
    console.error(`Admin initialization failed. ${INITIAL_ADMIN_GUIDANCE}`);
    process.exitCode = 1;
});
