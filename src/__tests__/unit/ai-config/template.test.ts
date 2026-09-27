// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
// This endpoint must not import any runtime configuration, vault or auth/DB path.
vi.mock("@/lib/ai-config/store", () => { throw Error("template must be static"); });
vi.mock("@/lib/ai-config/vault", () => { throw Error("template must not access keys"); });
vi.mock("@/lib/prisma", () => { throw Error("template must not access DB"); });
vi.mock("@/lib/ai-access", () => { throw Error("public static template must not load auth"); });
import { ConfigSchema } from "@/lib/ai-config/schema";
import { openExport, MAX_EXPORT_BYTES } from "@/lib/ai-config/crypto";
const loadTemplate = () => JSON.parse(readFileSync(path.join(process.cwd(), "docs/templates/solvnote-ai-config.template.json"), "utf8"));
it("contains a bounded synthetic portable-v1 example and no credentials", () => {
    const template = loadTemplate();
    expect(ConfigSchema.parse(template)).toEqual(template);
    expect(template.providers).toHaveLength(1); expect(template.models).toHaveLength(1);
    expect(template.providers[0]).toMatchObject({id:"provider-example", apiKey:"", enabled:false});
    expect(template.models[0]).toMatchObject({id:"model-example", providerId:"provider-example", enabled:false});
    expect(template.providers[0].baseUrl).toBe("https://api.example.invalid/v1");
    expect(template.chains).toEqual({text:[],vision:[]});
    expect(Buffer.byteLength(JSON.stringify(template))).toBeLessThan(8192);
    expect(JSON.stringify(template)).not.toMatch(/sk-|master.key|password|token|database|account|question/i);
});
it("downloads exactly the checked-in static template with public attachment headers", async () => {
    const route = await import("@/app/api/ai/config/template/route");
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="solvnote-ai-config.template.json"');
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(loadTemplate());
});
it("is accepted by the real importer without a password, before and after local editing", async () => {
    const template = loadTemplate();
    expect(await openExport(template, "")).toEqual(template);
    template.providers[0].apiKey = "synthetic-local-fill-only";
    expect(await openExport(template, "")).toEqual(template);
});
it("keeps plaintext template validation and sanitized diagnostics, not just schema shape", async () => {
    const template = loadTemplate();
    template.providers[0].baseUrl = "http://example.invalid?synthetic-private-only";
    await expect(openExport(template, "")).rejects.toMatchObject({message:"IMPORT_CONFIG_INCOMPATIBLE",issues:[{path:"providers.0.baseUrl",reason:"URL_POLICY"}]});
    template.providers[0].baseUrl = "https://api.example.invalid/v1";
    template.models[0].providerId = "missing";
    await expect(openExport(template, "")).rejects.toThrow("IMPORT_CONFIG_INCOMPATIBLE");
});
it("does not downgrade encrypted/mixed envelopes into plaintext or accept unbounded UTF-8", async () => {
    const template = loadTemplate();
    await expect(openExport({...template,format:"portable-ai-config",v:1}, "")).rejects.toThrow();
    await expect(openExport({...template,version:2}, "")).rejects.toThrow();
    await expect(openExport({...template,extra:"界".repeat(Math.ceil(MAX_EXPORT_BYTES/3))}, "")).rejects.toThrow("INVALID_EXPORT");
});
