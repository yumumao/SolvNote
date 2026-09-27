// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("sets isolated CI paths in a runner step, not in a job-level runner context", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const e2e = workflow.split(/\r?\n  e2e-test:/)[1]?.split(/\r?\n  [\w-]+:/)[0];
    expect(e2e).toBeDefined();
    const jobEnv = e2e.match(/\r?\n    env:\r?\n([\s\S]*?)\r?\n    steps:/)?.[1];
    expect(jobEnv).toBeDefined();
    expect(jobEnv).not.toMatch(/\$\{\{\s*runner\./);
    const temp = 'echo "SOLVNOTE_E2E_TEMP_DIR=$RUNNER_TEMP" >> "$GITHUB_ENV"';
    const db = 'echo "DATABASE_URL=file:$RUNNER_TEMP/solvnote-e2e-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.db" >> "$GITHUB_ENV"';
    expect(e2e).toContain(temp);
    expect(e2e).toContain(db);
    expect(e2e.indexOf(temp)).toBeLessThan(e2e.indexOf('name: Setup Database'));
    expect(e2e).toContain("AI_WORKER_DISABLED: '1'");
    expect(e2e).toContain("SOLVNOTE_ENABLE_AI_CONFIG_EXPORT: 'false'");
});
