const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');

const DEFAULT_ADMIN = {
    email: 'admin@localhost',
    name: 'Admin',
    role: 'admin',
    isActive: true,
    educationStage: 'junior_high',
    enrollmentYear: 2025,
};

const INITIAL_ADMIN_GUIDANCE = 'For a new installation, set INITIAL_ADMIN_PASSWORD to a non-blank value of at least 12 characters and optionally set INITIAL_ADMIN_EMAIL. Resolve any existing non-admin account conflict manually.';

async function seedAdmin({ prisma, hash: hashPassword, env = process.env }) {
    // A disabled or renamed administrator still owns the installation. Never
    // reset credentials, permissions, activation or education fields on restart.
    const existingAdmin = await prisma.user.findFirst({
        where: { role: DEFAULT_ADMIN.role },
        select: { id: true },
    });
    if (existingAdmin) {
        return { action: 'skipped' };
    }

    const password = env.INITIAL_ADMIN_PASSWORD;
    if (typeof password !== 'string' || password.length < 12 || !password.trim()) {
        throw new Error(INITIAL_ADMIN_GUIDANCE);
    }
    const email = env.INITIAL_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN.email;
    const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
    });
    if (existingUser) {
        throw new Error('Initial administrator bootstrap refused: the selected account already exists. Resolve the account conflict manually; no permissions were changed.');
    }

    const hashedPassword = await hashPassword(password, 12);
    await prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            name: DEFAULT_ADMIN.name,
            role: DEFAULT_ADMIN.role,
            isActive: DEFAULT_ADMIN.isActive,
            educationStage: DEFAULT_ADMIN.educationStage,
            enrollmentYear: DEFAULT_ADMIN.enrollmentYear,
        },
    });

    return { action: 'created' };
}

async function main() {
    const prisma = new PrismaClient();

    try {
        const result = await seedAdmin({ prisma, hash });
        if (result.action === 'created') {
            console.log('Success! Admin user created.');
        } else {
            console.log('An administrator already exists. No changes made.');
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(() => {
        // Database and hashing errors may contain credentials or account data.
        console.error(`Admin initialization failed. ${INITIAL_ADMIN_GUIDANCE}`);
        process.exitCode = 1;
    });
}

module.exports = { seedAdmin, DEFAULT_ADMIN };
