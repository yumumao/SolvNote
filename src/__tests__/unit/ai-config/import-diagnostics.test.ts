// @vitest-environment node
// All credentials/endpoints are synthetic; encrypt without consumer validation.
import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { openExport } from "@/lib/ai-config/crypto";
import fixture from "../../fixtures/scandex-portable-v1.json";
const password = "synthetic-互通-passphrase";
async function envelope(payload: unknown, raw = false) {
    const enc = new TextEncoder();
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const material = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 300000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, enc.encode(raw ? payload as string : JSON.stringify(payload)));
    return { ...fixture, salt: Buffer.from(salt).toString("base64"), iv: Buffer.from(iv).toString("base64"), data: Buffer.from(encrypted).toString("base64") };
}
async function config() { return openExport(fixture, "test-only-password"); }
describe("portable import diagnostics", () => {
    it("accepts ScanDex's 101-200 character display name without changing the upstream model", async () => {
        const c = await config(); c.models[0].model = c.models[0].name = "m".repeat(200);
        expect((await openExport(await envelope(c), password)).models[0]).toEqual(c.models[0]);
    });
    it.each(["http://example.com/v1", "https://example.com/v1?synthetic=private", "https://example.com/v1#private"])("reports decrypted URL policy rejection separately: %s", async (url) => {
        const c = await config(); c.providers[0].baseUrl = url;
        await expect(openExport(await envelope(c), password)).rejects.toMatchObject({
            message: "IMPORT_CONFIG_INCOMPATIBLE", issues: [{ path: "providers.0.baseUrl", reason: "URL_POLICY" }],
        });
    });
    it("does not bypass URL policy for disabled providers", async () => {
        const c = await config(); c.providers.push({ ...c.providers[0], id: "disabled-http", enabled: false, baseUrl: "http://example.com" });
        await expect(openExport(await envelope(c), password)).rejects.toMatchObject({ message: "IMPORT_CONFIG_INCOMPATIBLE" });
    });
    it("reports only fixed field paths, not secret values or validator details", async () => {
        const c = await config(); c.providers[0].name = "synthetic-private-label".repeat(100);
        let error: unknown; try { await openExport(await envelope(c), password); } catch (e) { error = e; }
        expect(error).toMatchObject({ message: "IMPORT_CONFIG_INCOMPATIBLE", issues: [{ path: "providers.0.name", reason: "FIELD_CONSTRAINT" }] });
        expect(JSON.stringify(error)).not.toContain("synthetic-private-label");
        expect(JSON.stringify(error)).not.toContain(c.providers[0].apiKey);
    });
    it("does not call a broken model reference a bad password", async () => {
        const c = await config(); c.models[0].providerId = "missing";
        await expect(openExport(await envelope(c), password)).rejects.toMatchObject({ message: "IMPORT_CONFIG_INCOMPATIBLE" });
    });
    it("separates authenticated non-JSON payloads from failed GCM authentication", async () => {
        const e = await envelope("not json", true);
        await expect(openExport(e, password)).rejects.toThrow("INVALID_EXPORT_PAYLOAD");
        await expect(openExport(e, password + "wrong")).rejects.toThrow("INVALID_EXPORT_OR_PASSPHRASE");
    });
});

it("classifies malformed decrypted URLs without letting the URL constructor escape", async () => {
    const c = await config(); c.providers[0].baseUrl = "synthetic-not-a-url";
    await expect(openExport(await envelope(c), password)).rejects.toMatchObject({ message: "IMPORT_CONFIG_INCOMPATIBLE", issues: [{ path: "providers.0.baseUrl", reason: "URL_POLICY" }, { path: "providers.0.baseUrl", reason: "URL_POLICY" }] });
});

import { importErrorMessage } from "@/lib/ai-config/import-errors";
it("keeps unknown apply outcomes uncertain rather than promising no write", () => {
    for (const error of [{ status: 408 }, { status: 502 }, Error("synthetic-private-error")]) {
        const message = importErrorMessage(error, "apply");
        expect(message).toContain("结果未知");
        expect(message).not.toContain("未写入");
        expect(message).not.toContain("synthetic-private-error");
    }
});
it("renders schema paths but never arbitrary proxy payloads or field names", () => {
    const message = importErrorMessage({ data: { message: "IMPORT_CONFIG_INCOMPATIBLE", issues: [
        { path: "providers.0.baseUrl", reason: "URL_POLICY" },
        { path: "synthetic-secret-path", reason: "synthetic-secret-reason" },
    ] } }, "preview");
    expect(message).toContain("providers.0.baseUrl"); expect(message).toContain("HTTPS");
    expect(message).not.toContain("synthetic-secret");
    expect(importErrorMessage({ data: { message: "__proto__" } }, "preview")).toContain("不能据此认定");
});

it("explains that origin validation concerns the notebook page, not the ScanDex export source", () => {
    const message = importErrorMessage({ data: { message: "IMPORT_ORIGIN_REJECTED" } }, "preview");
    expect(message).toContain("不是ScanDex");
    expect(message).toContain("错题本页面地址");
    expect(message).toContain("NEXTAUTH_URL");
    expect(message).toContain("未读取导入文件");
    expect(message).toContain("localhost");
    expect(message).toContain("127.0.0.1");
});
