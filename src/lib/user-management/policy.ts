export const DAY_MS = 86_400_000;
export const ACCOUNT_RETENTION_DAYS = 30;
export function isAccountExpired(user: {expiresAt?: Date | null}, now = new Date()): boolean {
 return user.expiresAt != null && user.expiresAt.getTime() <= now.getTime();
}
export function expirationDate(days: number | null, now = new Date()): Date | null {
 if (days === null) return null;
 if (days !== 7 && days !== 30) throw new Error("INVALID_ACCOUNT_LIFETIME");
 return new Date(now.getTime() + days * DAY_MS);
}
export function isPurgeDue(user: {expiresAt?: Date | null}, now = new Date()): boolean {
 return user.expiresAt != null && user.expiresAt.getTime() + ACCOUNT_RETENTION_DAYS * DAY_MS <= now.getTime();
}
export function assertRegistrationPolicy(value: Record<string, unknown>): void {
 if (![7, 30, null].includes(value.defaultExpirationDays as number | null) || typeof value.inviteRequired !== "boolean" || value.inviteMaxUses !== 1 || value.inviteLifetimeDays !== 30 || value.resetMode !== "temporary-password-and-force-change") throw new Error("USER_POLICY_NOT_CONFIRMED");
}
