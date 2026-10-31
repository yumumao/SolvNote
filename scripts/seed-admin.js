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

async function seedAdmin({ prisma, hash: hashPassword, env = process.env, onPhase = () => {} }) {
    // A disabled or renamed administrator still owns the installation. Never
    // reset credentials, permissions, activation or education fields on restart.
    onPhase('find-admin');
    const existingAdmin = await prisma.user.findFirst({
        where: { role: DEFAULT_ADMIN.role },
        select: { id: true },
    });
    if (existingAdmin) {
        return { action: 'skipped' };
    }

    onPhase('validate-password');
    const password = env.INITIAL_ADMIN_PASSWORD;
    if (typeof password !== 'string' || password.length < 12 || !password.trim()) {
        throw new Error(INITIAL_ADMIN_GUIDANCE);
    }
    const email = env.INITIAL_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN.email;
    onPhase('find-account');
    const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
    });
    if (existingUser) {
        onPhase('account-conflict');
        throw new Error('Initial administrator bootstrap refused: the selected account already exists. Resolve the account conflict manually; no permissions were changed.');
    }

    onPhase('hash-password');
    const hashedPassword = await hashPassword(password, 12);
    onPhase('create-admin');
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

// Only bounded diagnostic categories are public. Never log raw messages,
// stacks, metadata, credentials, email addresses or database URLs.
function failureDiagnostic({ error, stage }, env) {
    const allowedTypes = new Set([
        'Error', 'TypeError', 'RangeError', 'PrismaClientInitializationError',
        'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError',
        'PrismaClientValidationError', 'PrismaClientRustPanicError',
    ]);
    const code = error?.code ?? error?.errorCode;
    const safeCode = typeof code === 'string' &&
        (/^P[12][0-9]{3}$/.test(code) || ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'ENOENT', 'EIO'].includes(code))
        ? code : null;
    const password = env.INITIAL_ADMIN_PASSWORD;
    return {
        stage,
        errorType: allowedTypes.has(error?.name) ? error.name : 'UnknownError',
        errorCode: safeCode,
        initialPasswordPresent: typeof password === 'string' && password.length > 0,
        initialPasswordValid: typeof password === 'string' && password.length >= 12 && !!password.trim(),
    };
}

async function main() {
    let prisma;
    let stage = 'client-init';
    let failure;
    let result;
    try {
        prisma = new PrismaClient();
        result = await seedAdmin({ prisma, hash, onPhase: (value) => { stage = value; } });
    } catch (error) {
        failure = { error, stage };
    } finally {
        if (prisma) {
            try {
                await prisma.$disconnect();
            } catch (error) {
                // Cleanup must not replace the first, actionable failure.
                if (!failure) failure = { error, stage: 'disconnect' };
            }
        }
    }
    if (failure) {
        console.error('Admin initialization failed.');
        console.error('[AdminBootstrap] ' + JSON.stringify(failureDiagnostic(failure, process.env)));
        if (failure.stage === 'validate-password') console.error(INITIAL_ADMIN_GUIDANCE);
        if (failure.stage === 'account-conflict') {
            console.error('The selected account already exists without an administrator role. Resolve the conflict manually; no permissions were changed.');
        }
        process.exitCode = 1;
        return;
    }
    console.log(result.action === 'created'
        ? 'Success! Admin user created.'
        : 'An administrator already exists. No changes made.');
}

if (require.main === module) {
    main().catch(() => {
        console.error('Admin initialization failed. Diagnostic reporting failed; no raw error was logged.');
        process.exitCode = 1;
    });
}

module.exports = { seedAdmin, DEFAULT_ADMIN };
