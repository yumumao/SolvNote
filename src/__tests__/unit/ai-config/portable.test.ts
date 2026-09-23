// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sealExport, openExport } from "@/lib/ai-config/crypto";
import { parseConfig, mergeConfig } from "@/lib/ai-config/schema";
const config = {
    version: 1,
    providers: [
        {
            id: "p",
            name: "test",
            protocol: "chat",
            baseUrl: "https://example.com/v1",
            apiKey: "synthetic-only",
            enabled: true,
        },
    ],
    models: [
        {
            id: "m",
            providerId: "p",
            name: "test",
            model: "test-model",
            capabilities: ["text", "vision"],
            enabled: true,
        },
    ],
    chains: { text: ["m"], vision: ["m"] },
};
describe("portable AI config", () => {
    it("round trips without plaintext secret in envelope", async () => {
        const e = await sealExport(config, "test-only-password");
        expect(JSON.stringify(e)).not.toContain("synthetic-only");
        expect(await openExport(e, "test-only-password")).toEqual(config);
    });
    it("rejects wrong password, tampering, unreasonable KDF, unknown versions", async () => {
        const e = await sealExport(config, "test-only-password");
        await expect(openExport(e, "wrong-password!")).rejects.toThrow();
        await expect(
            openExport(
                { ...e, iv: Buffer.alloc(12).toString("base64") },
                "test-only-password",
            ),
        ).rejects.toThrow();
        await expect(
            openExport({ ...e, iter: 999999999 }, "test-only-password"),
        ).rejects.toThrow();
        await expect(
            openExport({ ...e, v: 2 }, "test-only-password"),
        ).rejects.toThrow();
    });
    it("rejects broken references and nonvision fallback", () => {
        expect(() =>
            parseConfig({
                ...config,
                chains: { text: ["missing"], vision: ["m"] },
            }),
        ).toThrow();
        expect(() =>
            parseConfig({
                ...config,
                models: [{ ...config.models[0], capabilities: ["text"] }],
            }),
        ).toThrow();
    });
    it("merges deterministically and keeps ordered chains without duplicates", () => {
        const c = parseConfig(config);
        expect(mergeConfig(c, c)).toEqual(c);
    });
    it("does not persist machine-specific fields", () => {
        expect(
            parseConfig({
                ...config,
                proxy: "private",
                machinePath: "private",
            }),
        ).not.toHaveProperty("proxy");
    });
});


it("refuses an export too large for portable import and whitespace-only passphrases", async () => {
    const huge = {...config, providers: Array.from({length: 50}, (_, i) => ({...config.providers[0], id: i ? `p${i}` : "p", apiKey: "x".repeat(16384)}))};
    await expect(sealExport(huge, "synthetic-passphrase-only")).rejects.toThrow("EXPORT_TOO_LARGE");
    await expect(sealExport(config, " ".repeat(12))).rejects.toThrow("PASSPHRASE_LENGTH");
});
