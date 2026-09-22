// @vitest-environment node
import { describe, expect, it } from "vitest";
import { anotherKey, chainsFromOrder, inferSharedOrder, moveInOrder, validChains } from "@/lib/ai-config/editor";
import { parseConfig, type PortableConfig, type AIModel } from "@/lib/ai-config/schema";
const model = (id: string, capabilities: AIModel["capabilities"] = ["text", "vision"], providerId = "p"): AIModel => ({ id, providerId, name: id, model: "same-model", capabilities, enabled: true });
const fixture = (): PortableConfig => ({ version: 1,
    providers: [{ id: "p", name: "合成连接", protocol: "chat", baseUrl: "https://example.invalid/v1", apiKey: "********", enabled: true }],
    models: [model("a"), model("b"), model("t", ["text"]), model("v", ["vision"])],
    chains: { text: ["a", "t", "b"], vision: ["a", "v", "b"] },
});
describe("AI editor credential/model hierarchy", () => {
    it("adds another credential with a distinct ID, empty key, and no cloned models", () => {
        const before = fixture(), next = anotherKey(before, "p", "other");
        expect(next.providers).toHaveLength(2);
        expect(next.providers[1]).toMatchObject({ id: "other", baseUrl: before.providers[0].baseUrl, apiKey: "" });
        expect(next.models).toEqual(before.models);
        expect(next.chains).toEqual(before.chains);
        expect(before.providers).toHaveLength(1);
        expect(parseConfig(next)).toEqual(next);
    });
    it("does not copy even a newly entered key", () => {
        const c = fixture(); c.providers[0].apiKey = "synthetic-only";
        expect(anotherKey(c, "p", "new").providers[1].apiKey).toBe("");
    });
    it("allows multiple same-name models under distinct credentials at the same endpoint", () => {
        const c = anotherKey(fixture(), "p", "other");
        c.models.push(model("other-a", ["text", "vision"], "other"));
        c.chains = chainsFromOrder(c, ["a", "other-a"]);
        expect(parseConfig(c).chains.text).toEqual(["a", "other-a"]);
    });
    it("keeps a missing source unchanged", () => expect(anotherKey(fixture(), "none", "new")).toEqual(fixture()));
});
describe("shared order compatibility", () => {
    it("infers an exact shared order with text-only and legacy vision-only models", () => {
        const c = fixture(), order = inferSharedOrder(c);
        expect(order).not.toBeNull(); expect(chainsFromOrder(c, order!)).toEqual(c.chains);
    });
    it("preserves conflicting orders as advanced mode", () => {
        const c = fixture(); c.chains = { text: ["a", "b"], vision: ["b", "a"] };
        expect(inferSharedOrder(c)).toBeNull();
    });
    it.each([
        { text: ["a"], vision: [] }, { text: [], vision: ["a"] },
        { text: ["a", "b"], vision: ["b"] },
    ])("does not expand existing task membership %j", (chains) => {
        expect(inferSharedOrder({ ...fixture(), chains })).toBeNull();
    });
    it("never turns legacy vision-only into text", () => {
        const c = fixture(); c.chains = { text: [], vision: ["v"] };
        expect(inferSharedOrder(c)).toEqual(["v"]);
        expect(chainsFromOrder(c, ["v"])).toEqual(c.chains);
    });
    it("filters disabled or deleted providers/models and duplicate IDs, never sends images to text-only", () => {
        const c = fixture(); c.models[0].enabled = false;
        expect(chainsFromOrder(c, ["a", "t", "t", "v", "absent"])).toEqual({ text: ["t"], vision: ["v"] });
        c.providers[0].enabled = false;
        expect(validChains(c)).toEqual({ text: [], vision: [] });
        c.providers = [];
        expect(chainsFromOrder(c, ["b"])).toEqual({ text: [], vision: [] });
    });
    it("preserves independent membership when validating after capability changes", () => {
        const c = fixture(); c.models[0].capabilities = ["text"];
        expect(validChains(c)).toEqual({ text: ["a", "t", "b"], vision: ["v", "b"] });
        c.models[2].capabilities.push("vision");
        expect(validChains(c).vision).not.toContain("t");
    });
    it("checks every pair of valid suborders for exact round-trip safety", () => {
        const permutations = (values: string[]): string[][] => [[], ...values.flatMap((id) => permutations(values.filter((v) => v !== id)).map((tail) => [id, ...tail]))];
        const c = fixture();
        for (const text of permutations(["a", "b", "t"])) for (const vision of permutations(["a", "b", "v"])) {
            c.chains = { text, vision }; const order = inferSharedOrder(c);
            if (order !== null) expect(chainsFromOrder(c, order)).toEqual(c.chains);
        }
    });
    it("retains all entries beyond chain limits instead of silently truncating", () => {
        const c = fixture(); c.models = Array.from({ length: 31 }, (_, i) => model(`x${i}`));
        expect(chainsFromOrder(c, c.models.map((m) => m.id)).text).toHaveLength(31);
    });
    it("moves entries without mutating the original order and guards boundaries", () => {
        const order = ["a", "b", "c"];
        expect(moveInOrder(order, 1, -1)).toEqual(["b", "a", "c"]);
        expect(moveInOrder(order, 0, -1)).toEqual(order);
        expect(moveInOrder(order, 2, 1)).toEqual(order);
        expect(order).toEqual(["a", "b", "c"]);
    });
});
