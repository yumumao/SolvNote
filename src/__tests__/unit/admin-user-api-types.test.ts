// @vitest-environment node
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import ts from "typescript";
import {describe, expect, it} from "vitest";

// Type declarations are erased at runtime: inspect the actual shared UI contract,
// without importing server modules, environment files, or database clients.
const source = ts.createSourceFile("api.ts", readFileSync(resolve(process.cwd(), "src/types/api.ts"), "utf8"), ts.ScriptTarget.Latest, true);
function properties(name: string) {
    const declaration = source.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === name);
    if (!declaration) throw new Error(`Missing API interface: ${name}`);
    return declaration.members.filter(ts.isPropertySignature);
}

describe("admin and profile UI type contracts", () => {
    it("permits only profile fields; password changes use the separate current-password API", () => {
        expect(properties("UpdateUserProfileRequest").map(p => p.name.getText(source)).sort()).toEqual([
            "educationStage", "email", "enrollmentYear", "name",
        ]);
    });
    it("includes admin lifecycle and revision fields, with optional counts and no password", () => {
        const fields = properties("AdminUser");
        expect(fields.map(p => p.name.getText(source))).toEqual(expect.arrayContaining(["role", "expiresAt", "mustChangePassword", "revision", "createdAt", "_count"]));
        expect(fields.find(p => p.name.getText(source) === "_count")?.questionToken).toBeDefined();
        expect(fields.map(p => p.name.getText(source))).not.toContain("password");
    });
});
