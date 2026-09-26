/** Solving records are retained until explicitly deleted, independently of notebook storage. */
export const SOLVING_JOB_KINDS = ["analyze", "reanswer"];
export function jobExpiry(kind: string, now = Date.now()) {
    return SOLVING_JOB_KINDS.includes(kind) ? new Date("9999-01-01T00:00:00Z") : new Date(now + 86400000);
}
export function readableJobWhere(now = new Date()) {
    return { OR: [{ kind: { in: SOLVING_JOB_KINDS } }, { expiresAt: { gt: now } }] };
}
