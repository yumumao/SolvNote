import {z} from "zod";
import {prisma} from "@/lib/prisma";
import {requireUser, assertSameOrigin} from "@/lib/ai-access";
import {userResponse, readUserJson} from "@/lib/user-management/http";
import {emailSchema} from "@/lib/user-management/schema";
import {assertEmailAvailable} from "@/lib/user-management/email-identity";
import {UserManagementError} from "@/lib/user-management/errors";
import {isAccountExpired} from "@/lib/user-management/policy";

const profile = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    email: emailSchema.optional(),
    educationStage: z.enum(["primary", "junior_high", "senior_high", "university"]).optional(),
    enrollmentYear: z.number().int().min(1900).max(2200).nullable().optional(),
}).strict();
const select = {name: true, email: true, educationStage: true, enrollmentYear: true} as const;

export async function GET(req: Request) {
    return userResponse(async () => {
        const user = await requireUser(req);
        return prisma.user.findUniqueOrThrow({where: {id: user.id}, select});
    });
}

export async function PATCH(req: Request) {
    return userResponse(async () => {
        const user = await requireUser(req);
        assertSameOrigin(req);
        // Capture the revision BEFORE waiting for an untrusted/streaming body.
        // Authentication's session version is pinned by requireUser, not recaptured here.
        const beforeBody = await prisma.user.findUnique({where: {id: user.id}, select: {revision: true}});
        if (!beforeBody) throw new UserManagementError("ACCESS_DENIED", 403);
        const data = profile.parse(await readUserJson(req, 8192));
        try {
            return await prisma.$transaction(async tx => {
                const current = await tx.user.findUnique({
                    where: {id: user.id},
                    select: {email: true, revision: true, sessionVersion: true, isActive: true, expiresAt: true, mustChangePassword: true},
                });
                const now = new Date();
                if (!current || !current.isActive || isAccountExpired(current, now) || current.mustChangePassword || current.sessionVersion !== user.sessionVersion) {
                    throw new UserManagementError("ACCESS_DENIED", 403);
                }
                if (current.revision !== beforeBody.revision) throw new UserManagementError("CONFLICT", 409);
                if (data.email !== undefined) await assertEmailAvailable(tx, data.email, user.id);
                // Even a case-only rewrite changes the exact email claim in old JWTs.
                // Keep name-only / genuinely unchanged-email edits session-preserving.
                const emailChanged = data.email !== undefined && data.email !== current.email;
                const changed = await tx.user.updateMany({
                    where: {
                        id: user.id,
                        revision: beforeBody.revision,
                        sessionVersion: user.sessionVersion,
                        isActive: true,
                        mustChangePassword: false,
                        OR: [{expiresAt: null}, {expiresAt: {gt: now}}],
                    },
                    data: {...data, revision: {increment: 1}, ...(emailChanged ? {sessionVersion: {increment: 1}} : {})},
                });
                if (changed.count !== 1) throw new UserManagementError("CONFLICT", 409);
                return tx.user.findUniqueOrThrow({where: {id: user.id}, select});
            }, {isolationLevel: "Serializable"});
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
            if (code === "P2002") throw new UserManagementError("EMAIL_UNAVAILABLE", 409);
            // Do not retry with a refreshed revision: that would silently overwrite
            // a concurrent edit. The caller can reload and deliberately retry instead.
            if (code === "P2034" || code === "P1008") throw new UserManagementError("CONFLICT", 409);
            throw error;
        }
    });
}
