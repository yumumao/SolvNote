// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("explicitly includes the static AI template in Docker's otherwise excluded docs directory", () => {
    const lines = readFileSync(path.join(process.cwd(), ".dockerignore"), "utf8")
        .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
    const template = "docs/templates/solvnote-ai-config.template.json";
    // Ordered allowlist: no blanket docs exclusion, then open only the template directory/file.
    const expected = ["docs/*", "!docs/templates/", "docs/templates/*", `!${template}`];
    const start = lines.indexOf(expected[0]);
    expect(lines).not.toContain("docs");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(lines.slice(start, start + expected.length)).toEqual(expected);
    expect(lines.slice(start + expected.length)).not.toContain("docs/**");
    expect(JSON.parse(readFileSync(path.join(process.cwd(), template), "utf8")).version).toBe(1);
    // Runtime credentials remain outside the build context.
    for (const privatePath of [".env", ".env.*", ".codex/", "config/app-config.json", "config/ai-master.key", "data/"]) {
        expect(lines).toContain(privatePath);
    }
});
