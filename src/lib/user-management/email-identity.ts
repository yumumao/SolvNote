import type {Prisma} from "@prisma/client";
import {emailSchema} from "./schema";
import {UserManagementError} from "./errors";

type IdentityReader = Pick<Prisma.TransactionClient, "$queryRaw">;
type EmailIdentity = {id: string; email: string};

/** Deliberately no provider-specific dot/plus aliases or locale-dependent folding. */
export function normalizeEmailIdentity(email: string): string {
    return email.trim().toLowerCase();
}

async function matchingIdentities(tx: IdentityReader, email: string): Promise<EmailIdentity[]> {
    const normalized = normalizeEmailIdentity(email);
    // SQLite lower()/NOCASE fold ASCII only. Include non-ASCII legacy candidates
    // and compare in JS using the SAME normalization as new email writes. Never
    // LIMIT before that comparison: a second matching identity must fail closed.
    // Read identity columns only; the login caller reads a password only after
    // proving that exactly one account matches. Values stay parameterized.
    const rows = await tx.$queryRaw<EmailIdentity[]>`
        SELECT "id", "email" FROM "User"
        WHERE lower(trim("email")) = ${normalized}
           OR "email" GLOB '*[^ -~]*'
    `;
    return rows.filter(row => normalizeEmailIdentity(row.email) === normalized);
}

/** Ambiguous old accounts are never disambiguated by password or active status. */
export async function findUniqueEmailIdentity(tx: IdentityReader, email: string): Promise<EmailIdentity | null> {
    const matches = await matchingIdentities(tx, email);
    return matches.length === 1 ? matches[0] : null;
}

/**
 * The caller owns the transaction and MUST perform the subsequent create/update
 * in that same transaction. No global client, nested transaction or side effect.
 * Pass the current account ID only for an update, never for account creation.
 * SQLite's serialized write transactions protect check + write; this is not a
 * substitute for a normalized unique index if the database backend is changed.
 */
export async function assertEmailAvailable(tx: Prisma.TransactionClient, email: string, excludedId?: string): Promise<void> {
    const normalized = emailSchema.parse(email);
    const matches = await matchingIdentities(tx, normalized);
    if (matches.some(row => row.id !== excludedId)) {
        throw new UserManagementError("EMAIL_UNAVAILABLE", 409);
    }
}