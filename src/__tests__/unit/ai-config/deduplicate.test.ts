import { describe, expect, it } from "vitest";
import { deduplicateConfig } from "@/lib/ai-config/deduplicate";
import type { PortableConfig } from "@/lib/ai-config/schema";

function fixture(): PortableConfig {
    return { version: 1,
        providers: ["a", "b"].map(id => ({ id, name: id, protocol: "chat", baseUrl: "https://example.invalid/v1", apiKey: "synthetic-same-key", enabled: true })),
        models: [
            { id: "m1", providerId: "a", name: "First", model: "model-one", capabilities: ["text", "vision"], enabled: true },
            { id: "m2", providerId: "b", name: "Second label", model: "model-one", capabilities: ["text", "vision"], enabled: true },
            { id: "m3", providerId: "b", name: "Third", model: "model-three", capabilities: ["text"], enabled: true },
        ], chains: { text: ["m2", "m3", "m1"], vision: ["m1", "m2"] },
    };
}
describe("saved AI configuration deduplication", () => {
    it("merges identical connections and upstream names, preserving earliest per-task order", () => {
        const original = fixture(), before = structuredClone(original);
        const result = deduplicateConfig(original);
        expect(result.config.providers.map(p => p.id)).toEqual(["a"]);
        expect(result.config.models.map(m => [m.id, m.providerId])).toEqual([["m1", "a"], ["m3", "a"]]);
        expect(result.config.chains).toEqual({ text: ["m1", "m3"], vision: ["m1"] });
        expect(result.groups).toHaveLength(2);
        expect(result.changed).toBe(true);
        expect(original).toEqual(before);
        expect(deduplicateConfig(result.config).changed).toBe(false);
    });
    it.each(["different", "", "********", " "])("does not merge unsafe/different key %s", key => {
        const c = fixture(); c.providers[1].apiKey = key;
        if (key !== "different") c.providers[0].apiKey = key;
        const r = deduplicateConfig(c);
        expect(r.config.providers).toHaveLength(2);
        expect(r.config.models).toHaveLength(3);
        expect(r.changed).toBe(false);
    });
    it.each(["protocol", "apiVersion", "path", "pathCase"])("keeps different endpoint semantics: %s", field => {
        const c = fixture();
        if (field === "protocol") c.providers[1].protocol = "responses";
        if (field === "apiVersion") c.providers[1].apiVersion = "synthetic-version";
        if (field === "path") c.providers[1].baseUrl += "/other";
        if (field === "pathCase") c.providers[1].baseUrl = "https://example.invalid/V1";
        expect(deduplicateConfig(c).changed).toBe(false);
    });
    it("normalizes host case/default port/trailing slash, not key whitespace", () => {
        const c = fixture(); c.providers[1].baseUrl = "https://EXAMPLE.invalid:443/v1/";
        expect(deduplicateConfig(c).config.providers).toHaveLength(1);
        c.providers[1].apiKey += " ";
        expect(deduplicateConfig(c).changed).toBe(false);
    });
    it("does not use the display label or change actual model-name case", () => {
        const c = fixture(); c.models[1].model = "MODEL-one"; c.models[1].name = c.models[0].name;
        expect(deduplicateConfig(c).config.models).toHaveLength(3);
    });
    it("defaults capability conflicts to separate and supports explicit keep selection without union", () => {
        const c = fixture(); c.models[0].capabilities = ["vision"]; c.chains.text = ["m2", "m3"];
        const r = deduplicateConfig(c);
        expect(r.config.models).toHaveLength(3);
        expect(r.groups.find(g => g.kind === "model")).toMatchObject({ conflict: true, keepId: null });
        const selected = deduplicateConfig(c, [{ kind: "model", groupId: "m1", keepId: "m1" }]);
        expect(selected.config.models[0].capabilities).toEqual(["vision"]);
        expect(selected.config.chains).toEqual({ text: ["m3"], vision: ["m1"] });
    });
    it("does not activate disabled connections by default; explicit selection is previewed", () => {
        const c = fixture(); c.providers[1].enabled = false; c.chains = { text: ["m1"], vision: ["m1"] };
        const r = deduplicateConfig(c);
        expect(r.changed).toBe(false);
        expect(r.groups[0]).toMatchObject({ conflict: true, keepId: null });
        const selected = deduplicateConfig(c, [{ kind: "connection", groupId: "a", keepId: "b" }]);
        expect(selected.config.providers[0].enabled).toBe(false);
        expect(selected.config.chains).toEqual({ text: [], vision: [] });
    });
    it("lets administrators retain duplicates intentionally", () => {
        const c = fixture();
        const r = deduplicateConfig(c, [{ kind: "connection", groupId: "a", keepId: null }]);
        expect(r.changed).toBe(false);
    });
    it("merges duplicate models within one connection, including disabled-model conflicts", () => {
        const c = fixture(); c.providers = [c.providers[0]]; c.models.forEach(m => m.providerId = "a");
        c.models[1].enabled = false; c.chains = { text: ["m1", "m3"], vision: ["m1"] };
        expect(deduplicateConfig(c).changed).toBe(false);
        const r = deduplicateConfig(c, [{ kind: "model", groupId: "m1", keepId: "m1" }]);
        expect(r.config.models).toHaveLength(2);
    });
    it("does not auto-enrol models in a new task when capabilities are identical", () => {
        const c = fixture(); c.chains = { text: ["m2"], vision: [] };
        expect(deduplicateConfig(c).config.chains).toEqual({ text: ["m1"], vision: [] });
    });
    it.each([
        { choices: [{ kind: "connection", groupId: "a", keepId: "unknown" }] },
        { choices: [{ kind: "model", groupId: "missing", keepId: null }] },
        { choices: [{ kind: "connection", groupId: "a", keepId: null }, { kind: "connection", groupId: "a", keepId: "a" }] },
    ])("rejects forged or duplicate selections", ({ choices }) => {
        expect(() => deduplicateConfig(fixture(), choices as Parameters<typeof deduplicateConfig>[1])).toThrow("INVALID_REQUEST");
    });
});
