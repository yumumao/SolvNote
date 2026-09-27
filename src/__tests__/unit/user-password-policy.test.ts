import { describe, expect, it } from "vitest";
import { passwordSchema, registrationSchema, changePasswordSchema } from "@/lib/user-management/schema";

// Synthetic passwords only: this checks policy boundaries, not password strength.
describe("user password length policy", () => {
    it.each([
        ["", false], ["x".repeat(7), false], ["abcdefgh", true],
        ["12345678", true], ["x".repeat(14), true], ["x".repeat(15), true],
        ["x".repeat(72), true], ["x".repeat(73), false],
        ["中".repeat(7), false], ["中".repeat(8), true],
        ["中".repeat(24), true], ["中".repeat(25), false],
        ["😀".repeat(4), true],
    ] as const)("applies the 8-character minimum and 72-byte maximum consistently (%#)", (password, accepted) => {
        expect(passwordSchema.safeParse(password).success).toBe(accepted);
        expect(registrationSchema.safeParse({
            email: "member@example.invalid", name: "Synthetic member", password,
            turnstileToken: "synthetic-token",
        }).success).toBe(accepted);
        expect(changePasswordSchema.safeParse({ currentPassword: "old", newPassword: password }).success).toBe(accepted);
    });
    it("still requires a current password without applying the new minimum to legacy passwords", () => {
        expect(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "abcdefgh" }).success).toBe(true);
        expect(changePasswordSchema.safeParse({ currentPassword: "", newPassword: "abcdefgh" }).success).toBe(false);
    });
});