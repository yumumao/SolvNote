// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertAiConfigExportEnabled, isAiConfigExportEnabled } from "@/lib/ai-config/export-policy";
const variable = "SOLVNOTE_ENABLE_AI_CONFIG_EXPORT";
afterEach(() => vi.unstubAllEnvs());
describe("server-only AI export policy", () => {
    it.each([undefined, "", " ", "false", "FALSE", "1", "yes", "on", "true-ish", "true false", "true\0", '"true"'])
        ("fails closed for %s", value => {
            const env: NodeJS.ProcessEnv = { NODE_ENV: "test", [variable]: value };
            expect(isAiConfigExportEnabled(env)).toBe(false);
            expect(() => assertAiConfigExportEnabled(env)).toThrow("AI_CONFIG_EXPORT_DISABLED");
        });
    it.each(["true", "TRUE", "TrUe", " true ", "\tTRUE\n"])("accepts only explicit true: %s", value => {
        expect(isAiConfigExportEnabled({ NODE_ENV: "test", [variable]: value })).toBe(true);
        expect(() => assertAiConfigExportEnabled({ NODE_ENV: "test", [variable]: value })).not.toThrow();
    });
    it("reads deployment environment at call time, not module initialization", () => {
        vi.stubEnv(variable, undefined);
        expect(isAiConfigExportEnabled()).toBe(false);
        vi.stubEnv(variable, "true");
        expect(() => assertAiConfigExportEnabled()).not.toThrow();
        vi.stubEnv(variable, "false");
        expect(() => assertAiConfigExportEnabled()).toThrow("AI_CONFIG_EXPORT_DISABLED");
    });
    it("ignores public/client aliases", () => {
        expect(isAiConfigExportEnabled({ NODE_ENV: "test", NEXT_PUBLIC_SOLVNOTE_ENABLE_AI_CONFIG_EXPORT: "true" })).toBe(false);
    });
});
