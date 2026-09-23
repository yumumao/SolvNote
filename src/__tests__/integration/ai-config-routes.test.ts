// @vitest-environment node
/**
 * Route + real store/crypto integration against an isolated SQLite database.
 * Only authentication and the legacy configuration reader are mocked. No real
 * config, vault key, user database, provider endpoint, or network is accessed.
 */
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { PortableConfig } from "@/lib/ai-config/schema";
import type { ExportEnvelope } from "@/lib/ai-config/crypto";

const shared = vi.hoisted(() => ({
    db: null as unknown as PrismaClient,
    current: null as { id: string; role: string; isActive: boolean } | null,
    requireAdmin:
        vi.fn<(req?: Request) => Promise<{ id: string; role: string }>>(),
    legacy: vi.fn(),
    network: vi.fn(() => {
        throw new Error("NETWORK_DISABLED_IN_CONFIG_ROUTE_TESTS");
    }),
}));
vi.mock("@/lib/prisma", () => ({
    get prisma() {
        return shared.db;
    },
}));
vi.mock("@/lib/config", () => ({ getAppConfig: shared.legacy }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({
    getServerSession: vi.fn(() => {
        throw new Error("USE_MOCK_CURRENT_USER");
    }),
}));
vi.mock("@/lib/ai-access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/ai-access")>()),
    requireAdmin: shared.requireAdmin,
}));

import { GET, POST } from "@/app/api/ai/config/route";
import { POST as DEDUP } from "@/app/api/ai/config/deduplicate/route";
import { POST as IMPORT } from "@/app/api/ai/config/import/route";
import { AIRequestError } from "@/lib/ai-access";
import { sealExport, openExport } from "@/lib/ai-config/crypto";
import { protect, unprotect } from "@/lib/ai-config/vault";
import * as store from "@/lib/ai-config/store";
import { mergeConfig } from "@/lib/ai-config/schema";

const ORIGIN = "https://notebook.example.com";
const PASSWORD = "synthetic-export-passphrase-only";
const MASK = "********";
function fixture(suffix: string): PortableConfig {
    return {
        version: 1,
        providers: [
            {
                id: `provider-${suffix}`,
                name: `Synthetic ${suffix}`,
                protocol: "chat",
                baseUrl: `https://example.com/${suffix}/v1`,
                apiKey: `synthetic-${suffix}-key-only`,
                enabled: true,
            },
        ],
        models: [
            {
                id: `model-${suffix}`,
                providerId: `provider-${suffix}`,
                name: `Synthetic ${suffix}`,
                model: `synthetic-model-${suffix}`,
                capabilities: ["text", "vision"],
                enabled: true,
            },
        ],
        chains: { text: [`model-${suffix}`], vision: [`model-${suffix}`] },
    };
}
const current = fixture("current");
const incoming = fixture("incoming");
const alternative = fixture("alternative");
const merged: PortableConfig = {
    version: 1,
    providers: [...current.providers, ...incoming.providers],
    models: [...current.models, ...incoming.models],
    chains: {
        text: ["model-incoming", "model-current"],
        vision: ["model-incoming", "model-current"],
    },
};
const overlapping: PortableConfig = {
    ...merged,
    providers: [
        {
            ...current.providers[0],
            name: "Replacement name",
            apiKey: "synthetic-replacement-key-only",
        },
        ...incoming.providers,
    ],
    models: [
        { ...current.models[0], model: "synthetic-replacement-model" },
        ...incoming.models,
    ],
};
let envelope: ExportEnvelope;
let otherEnvelope: ExportEnvelope;
let overlappingEnvelope: ExportEnvelope;
let directory: string;
const syntheticMasterKey = randomBytes(32).toString("hex");
function freshFileVault() {
    const vault = mkdtempSync(path.join(directory, "vault-"));
    vi.stubEnv("AI_CONFIG_MASTER_KEY", "");
    vi.stubEnv("AI_CONFIG_DIR", vault);
    return path.join(vault, "ai-master.key");
}

type Mode = "merge" | "replace";
interface Preview {
    config: PortableConfig;
    revision: number;
    expires: number;
    previewToken: string;
}
function masked(config: PortableConfig): PortableConfig {
    return {
        ...config,
        providers: config.providers.map((provider) => ({
            ...provider,
            apiKey: provider.apiKey ? MASK : "",
        })),
    };
}
function request(
    endpoint: "config" | "import" | "deduplicate",
    body: unknown,
    extraHeaders?: HeadersInit,
): Request {
    const headers = new Headers({
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
    });
    new Headers(extraHeaders).forEach((value, name) =>
        headers.set(name, value),
    );
    return new Request(
        `${ORIGIN}/api/ai/config${endpoint === "config" ? "" : `/${endpoint}`}`,
        {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        },
    );
}
function importBody(
    action: "preview" | "apply" = "preview",
    mode: Mode = "replace",
    source = envelope,
) {
    return { action, mode, envelope: source, password: PASSWORD };
}
function applyBody(
    preview: Preview,
    mode: Mode = "replace",
    source = envelope,
) {
    return {
        ...importBody("apply", mode, source),
        revision: preview.revision,
        expires: preview.expires,
        previewToken: preview.previewToken,
    };
}
async function preview(
    mode: Mode = "replace",
    source = envelope,
): Promise<Preview> {
    const response = await IMPORT(
        request("import", importBody("preview", mode, source)),
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<Preview>;
}
async function row() {
    return shared.db.aiConfiguration.findUniqueOrThrow({
        where: { id: "site" },
    });
}
async function expectStored(config: PortableConfig, revision: number) {
    const saved = await row();
    expect(saved.revision).toBe(revision);
    expect(unprotect(saved.payload)).toEqual(config);
    for (const provider of config.providers)
        if (provider.apiKey)
            expect(saved.payload).not.toContain(provider.apiKey);
}
async function expectMaskedResponse(
    response: Response,
    config: PortableConfig,
    revision: number,
) {
    expect(response.status).toBe(200);
    const raw = await response.text();
    for (const provider of config.providers)
        if (provider.apiKey) expect(raw).not.toContain(provider.apiKey);
    expect(raw).not.toContain(PASSWORD);
    expect(JSON.parse(raw)).toMatchObject({ config: masked(config), revision });
}

beforeAll(async () => {
    // Deliberately no CLI migration/.env loading: create only the store's table
    // in a unique ignored test directory, using the public migration's DDL.
    const root = path.resolve(".codex/tmp");
    mkdirSync(root, { recursive: true });
    directory = mkdtempSync(path.join(root, "ai-config-routes-"));
    vi.stubEnv("AI_CONFIG_MASTER_KEY", syntheticMasterKey);
    vi.stubEnv("AI_CONFIG_DIR", path.join(directory, "vault"));
    vi.stubGlobal("fetch", shared.network);
    shared.db = new PrismaClient({
        datasources: {
            db: {
                url: `file:${path.join(directory, "test.db").replaceAll("\\", "/")}`,
            },
        },
    });
    await shared.db.$executeRawUnsafe(
        'CREATE TABLE "AiConfiguration" ("id" TEXT NOT NULL PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 1, "payload" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)',
    );
    [envelope, otherEnvelope, overlappingEnvelope] = await Promise.all([
        sealExport(incoming, PASSWORD),
        sealExport(alternative, PASSWORD),
        sealExport(overlapping, PASSWORD),
    ]);
}, 30000);
beforeEach(async () => {
    vi.stubEnv("AI_CONFIG_MASTER_KEY", syntheticMasterKey);
    vi.stubEnv("AI_CONFIG_DIR", path.join(directory, "vault"));
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    await shared.db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS "reject_config_write"',
    );
    await shared.db.aiConfiguration.deleteMany();
    await shared.db.aiConfiguration.create({
        data: { id: "site", revision: 1, payload: protect(current) },
    });
    shared.current = { id: "synthetic-admin-a", role: "admin", isActive: true };
    shared.requireAdmin.mockReset().mockImplementation(async () => {
        if (!shared.current)
            throw new AIRequestError(401, "Authentication required");
        if (!shared.current.isActive || shared.current.role !== "admin")
            throw new AIRequestError(403, "Administrator access required");
        return { id: shared.current.id, role: shared.current.role };
    });
    shared.legacy.mockReset().mockReturnValue({
        aiProvider: "openai",
        openai: {
            activeInstanceId: "legacy-test",
            instances: [
                {
                    id: "legacy-test",
                    name: "Synthetic legacy",
                    baseUrl: "https://example.com/legacy/v1",
                    apiKey: "synthetic-legacy-key-only",
                    model: "synthetic-legacy-model",
                },
            ],
        },
    });
});
afterAll(async () => {
    try {
        if (shared.db) await shared.db.$disconnect();
        expect(shared.network).not.toHaveBeenCalled();
    } finally {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    }
    // Only encrypted synthetic fixtures remain in .codex/tmp for failure review.
});

type Operation = "get" | "save" | "preview" | "apply";
function invoke(
    operation: Operation,
    headers?: HeadersInit,
): Promise<Response> {
    if (operation === "get") return GET(new Request(`${ORIGIN}/api/ai/config`));
    if (operation === "save")
        return POST(
            request("config", { config: current, revision: 1 }, headers),
        );
    return IMPORT(
        request(
            "import",
            {
                ...importBody(operation),
                revision: 1,
                expires: Date.now() + 60000,
                previewToken: "0".repeat(64),
            },
            headers,
        ),
    );
}

describe.sequential(
    "AI config route authorization and origin boundaries",
    () => {
        describe.each<Operation>(["get", "save", "preview", "apply"])(
            "%s",
            (operation) => {
                it.each([
                    { label: "anonymous", user: null, status: 401 },
                    {
                        label: "ordinary user",
                        user: {
                            id: "synthetic-user",
                            role: "user",
                            isActive: true,
                        },
                        status: 403,
                    },
                    {
                        label: "inactive admin",
                        user: {
                            id: "synthetic-admin",
                            role: "admin",
                            isActive: false,
                        },
                        status: 403,
                    },
                ])(
                    "rejects $label before reading or migrating configuration",
                    async ({ user, status }) => {
                        shared.current = user;
                        await shared.db.aiConfiguration.deleteMany();
                        const response = await invoke(operation);
                        expect(response.status).toBe(status);
                        expect(await response.json()).toEqual({
                            message:
                                status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
                        });
                        expect(shared.requireAdmin).toHaveBeenCalledTimes(1);
                        expect(
                            shared.requireAdmin.mock.calls[0][0],
                        ).toBeInstanceOf(Request);
                        expect(shared.legacy).not.toHaveBeenCalled();
                        expect(await shared.db.aiConfiguration.count()).toBe(0);
                    },
                );
            },
        );

        const crossOriginCases: { label: string; headers: HeadersInit }[] = [
            {
                label: "foreign Origin with same-origin fetch metadata",
                headers: { Origin: "https://foreign.example.com" },
            },
            { label: "opaque Origin", headers: { Origin: "null" } },
            {
                label: "cross-site metadata despite a matching Origin",
                headers: { "Sec-Fetch-Site": "cross-site" },
            },
            {
                label: "same-site metadata",
                headers: { "Sec-Fetch-Site": "same-site" },
            },
        ];
        describe.each<Operation>(["save", "preview", "apply"])(
            "%s same-origin enforcement",
            (operation) => {
                it.each(crossOriginCases)(
                    "rejects $label without mutation",
                    async ({ headers }) => {
                        const before = await row();
                        const response = await invoke(operation, headers);
                        expect(response.status).toBe(403);
                        expect(await row()).toEqual(before);
                        expect(shared.legacy).not.toHaveBeenCalled();
                    },
                );
            },
        );

        it("checks the current administrator on every request, including after demotion", async () => {
            expect((await invoke("get")).status).toBe(200);
            shared.current = {
                id: "synthetic-admin-a",
                role: "user",
                isActive: true,
            };
            expect((await invoke("get")).status).toBe(403);
            expect(shared.requireAdmin).toHaveBeenCalledTimes(2);
        });
        it("allows authenticated non-browser writes without Origin/fetch metadata", async () => {
            const req = request("config", {
                config: masked(current),
                revision: 1,
            });
            req.headers.delete("origin");
            req.headers.delete("sec-fetch-site");
            await expectMaskedResponse(await POST(req), current, 2);
        });
    },
);

describe.sequential("GET/POST /api/ai/config", () => {
    it("GET returns only masked provider keys and does not change an initialized store", async () => {
        const before = await row();
        const response = await invoke("get");
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expectMaskedResponse(response, current, 1);
        expect(await row()).toEqual(before);
        expect(shared.legacy).not.toHaveBeenCalled();
    });
    it("resolves a masked save by provider ID, without persisting the placeholder", async () => {
        const config = masked(current);
        config.providers[0].name = "Updated display name";
        const expected = {
            ...current,
            providers: [
                { ...current.providers[0], name: "Updated display name" },
            ],
        };
        await expectMaskedResponse(
            await POST(request("config", { config, revision: 1 })),
            expected,
            2,
        );
        await expectStored(expected, 2);
    });
    it.each([
        "https://other.example.com/current/v1",
        "https://example.com/other/v1",
        "https://example.com:8443/current/v1",
        "https://example.com/Current/v1",
    ])(
        "does not reuse a masked key for a changed target (%s)",
        async (baseUrl) => {
            const before = await row();
            const config = masked(current);
            config.providers[0].baseUrl = baseUrl;
            const response = await POST(
                request("config", { config, revision: 1 }),
            );
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                message: "INVALID_REQUEST_OR_CONFIGURATION",
            });
            expect(await row()).toEqual(before);
        },
    );
    it.each(["responses", "responses_codex", "gemini", "azure"] as const)(
        "does not reuse a masked key for a changed protocol (%s)",
        async (protocol) => {
            const before = await row();
            const config = masked(current);
            config.providers[0].protocol = protocol;
            expect(
                (await POST(request("config", { config, revision: 1 }))).status,
            ).toBe(400);
            expect(await row()).toEqual(before);
        },
    );
    it.each([
        "https://example.com/current/v1/",
        "https://EXAMPLE.com:443/current/v1///",
        "https://example.com/current/segment/../v1",
    ])(
        "preserves a masked key for the same normalized target (%s)",
        async (baseUrl) => {
            const config = masked(current);
            config.providers[0].baseUrl = baseUrl;
            const expected = fixture("current");
            expected.providers[0].baseUrl = baseUrl;
            await expectMaskedResponse(
                await POST(request("config", { config, revision: 1 })),
                expected,
                2,
            );
            await expectStored(expected, 2);
        },
    );
    it.each(["synthetic-explicit-replacement-key-only", ""])(
        "allows an explicit replacement/cleared key when changing target and protocol",
        async (apiKey) => {
            const config = fixture("current");
            Object.assign(config.providers[0], {
                baseUrl: "https://other.example.com/v1",
                protocol: "responses",
                apiKey,
            });
            await expectMaskedResponse(
                await POST(request("config", { config, revision: 1 })),
                config,
                2,
            );
            await expectStored(config, 2);
        },
    );
    it("rejects a placeholder on an unknown provider without partial writes", async () => {
        const before = await row();
        const response = await POST(
            request("config", { config: masked(incoming), revision: 1 }),
        );
        expect(response.status).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("accepts an explicit empty key as clearing, not as preserving a previous key", async () => {
        const config = fixture("current");
        config.providers[0].apiKey = "";
        await expectMaskedResponse(
            await POST(request("config", { config, revision: 1 })),
            config,
            2,
        );
        await expectStored(config, 2);
    });
    it("encrypts replacement keys at rest and masks the save response", async () => {
        await expectMaskedResponse(
            await POST(request("config", { config: incoming, revision: 1 })),
            incoming,
            2,
        );
        await expectStored(incoming, 2);
    });
    it.each([undefined, "1", 1.5])(
        "rejects a noninteger/missing revision (%s)",
        async (revision) => {
            const before = await row();
            expect(
                (await POST(request("config", { config: incoming, revision })))
                    .status,
            ).toBe(400);
            expect(await row()).toEqual(before);
        },
    );
    it("rejects broken references without updating payload or revision", async () => {
        const before = await row();
        const invalid = {
            ...incoming,
            chains: { text: ["missing-model"], vision: [] },
        };
        expect(
            (await POST(request("config", { config: invalid, revision: 1 })))
                .status,
        ).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("rejects a stale save rather than overwriting a newer revision", async () => {
        await store.saveAIConfig(alternative, 1);
        const before = await row();
        const response = await POST(
            request("config", { config: incoming, revision: 1 }),
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ message: "CONFIG_CONFLICT" });
        expect(await row()).toEqual(before);
    });
    it("bounds actual request bytes even without a Content-Length header", async () => {
        const before = await row();
        const req = request("config", { padding: "x".repeat(1024 * 1024 + 1) });
        expect(req.headers.has("content-length")).toBe(false);
        const response = await POST(req);
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ message: "BODY_TOO_LARGE" });
        expect(await row()).toEqual(before);
    });
});

describe.sequential("POST /api/ai/config/import preview and apply", () => {
    it.each<Mode>(["merge", "replace"])(
        "%s preview masks keys and never writes an initialized store",
        async (mode) => {
            const before = await row();
            const response = await IMPORT(
                request("import", importBody("preview", mode)),
            );
            expect(response.headers.get("cache-control")).toBe("no-store");
            const data: Preview = await response.clone().json();
            await expectMaskedResponse(
                response,
                mode === "merge" ? merged : incoming,
                1,
            );
            expect(data.previewToken).toMatch(/^[a-f0-9]{64}$/);
            expect(data.expires).toBeGreaterThan(Date.now());
            expect(data.expires).toBeLessThanOrEqual(Date.now() + 300000);
            expect(await row()).toEqual(before);
        },
    );
    it("does not create/migrate a configuration row during the first preview", async () => {
        await shared.db.aiConfiguration.deleteMany();
        const response = await IMPORT(request("import", importBody()));
        await expectMaskedResponse(response, incoming, 0);
        expect(await shared.db.aiConfiguration.count()).toBe(0);
    });
    it("does not leave a migrated row behind after an invalid first apply", async () => {
        await shared.db.aiConfiguration.deleteMany();
        const response = await invoke("apply");
        expect([400, 409]).toContain(response.status);
        expect(await shared.db.aiConfiguration.count()).toBe(0);
    });
    it.each(["preview", "apply"] as const)(
        "rejects a wrong password during %s without writes or crypto error leakage",
        async (action) => {
            const before = await row();
            const response = await IMPORT(
                request("import", {
                    ...importBody(action),
                    password: "synthetic-wrong-passphrase",
                }),
            );
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                message: "INVALID_EXPORT_OR_PASSPHRASE",
            });
            expect(await row()).toEqual(before);
        },
    );
    it.each(["invalid-tag", "unbounded-kdf", "unsupported-version"] as const)(
        "rejects %s envelopes before any write",
        async (fault) => {
            const before = await row();
            const damaged = { ...envelope };
            if (fault === "invalid-tag") {
                const bytes = Buffer.from(damaged.data, "base64");
                bytes[bytes.length - 1] ^= 1;
                damaged.data = bytes.toString("base64");
            }
            const raw =
                fault === "unbounded-kdf"
                    ? { ...damaged, iter: 999999999 }
                    : fault === "unsupported-version"
                      ? { ...damaged, v: 2 }
                      : damaged;
            const response = await IMPORT(
                request("import", { ...importBody(), envelope: raw }),
            );
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                message: fault === "invalid-tag" ? "INVALID_EXPORT_OR_PASSPHRASE" : "UNSUPPORTED_EXPORT",
            });
            expect(await row()).toEqual(before);
        },
    );
    it.each<Mode>(["merge", "replace"])(
        "applies %s atomically with a fresh signed preview",
        async (mode) => {
            const approved = await preview(mode);
            const response = await IMPORT(
                request("import", applyBody(approved, mode)),
            );
            const expected = mode === "merge" ? merged : incoming;
            await expectMaskedResponse(response, expected, 2);
            await expectStored(expected, 2);
        },
    );
    it("merge overwrites matching IDs while retaining deterministic chains without duplicates", async () => {
        const approved = await preview("merge", overlappingEnvelope);
        const response = await IMPORT(
            request(
                "import",
                applyBody(approved, "merge", overlappingEnvelope),
            ),
        );
        await expectMaskedResponse(response, overlapping, 2);
        await expectStored(overlapping, 2);
    });
    it("binds to decrypted content rather than the random encryption envelope", async () => {
        const approved = await preview();
        const reencrypted = await sealExport(incoming, PASSWORD);
        expect(reencrypted.data).not.toBe(envelope.data);
        const response = await IMPORT(
            request("import", applyBody(approved, "replace", reencrypted)),
        );
        await expectMaskedResponse(response, incoming, 2);
    });
});

describe.sequential(
    "first import snapshots, vault and atomic initialization",
    () => {
        it("can inspect an unpersisted legacy snapshot without creating a row or master key", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const keyFile = freshFileVault();
            const snapshot = await store.loadAIConfig({ persist: false });
            expect(snapshot.revision).toBe(0);
            expect(snapshot.config.providers).toHaveLength(1);
            expect(snapshot.config.providers[0].baseUrl).toBe(
                "https://example.com/legacy/v1",
            );
            expect(await shared.db.aiConfiguration.count()).toBe(0);
            expect(existsSync(keyFile)).toBe(false);
        });
        it("initializes only a signing/master key on first preview and reuses it without a configuration row", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const keyFile = freshFileVault();
            const first = await preview();
            expect(first.revision).toBe(0);
            expect(await shared.db.aiConfiguration.count()).toBe(0);
            const key = readFileSync(keyFile);
            expect(key.length).toBe(32);
            const second = await preview("merge");
            expect(second.revision).toBe(0);
            expect(readFileSync(keyFile).equals(key)).toBe(true);
            expect(await shared.db.aiConfiguration.count()).toBe(0);
            await expectMaskedResponse(
                await IMPORT(request("import", applyBody(first))),
                incoming,
                1,
            );
            await expectStored(incoming, 1);
            expect(readFileSync(keyFile).equals(key)).toBe(true);
        });
        it("does not initialize a key or row for an invalid first apply without a preview", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const keyFile = freshFileVault();
            const response = await IMPORT(
                request("import", {
                    ...importBody("apply"),
                    revision: 0,
                    expires: Date.now() + 60000,
                    previewToken: "0".repeat(64),
                }),
            );
            expect([400, 409]).toContain(response.status);
            expect(await shared.db.aiConfiguration.count()).toBe(0);
            expect(existsSync(keyFile)).toBe(false);
        });
        it("does not recreate a lost preview signing key during first apply", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const originalFile = freshFileVault();
            const approved = await preview();
            const originalKey = readFileSync(originalFile);
            const missingFile = freshFileVault();
            const response = await IMPORT(
                request("import", applyBody(approved)),
            );
            expect(response.status).toBe(400);
            expect(await shared.db.aiConfiguration.count()).toBe(0);
            expect(existsSync(missingFile)).toBe(false);
            expect(readFileSync(originalFile).equals(originalKey)).toBe(true);
        });
        it("does not rotate an invalid existing key even when the configuration row is absent", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const keyFile = freshFileVault();
            const invalidKey = Buffer.alloc(7, 1);
            writeFileSync(keyFile, invalidKey);
            const response = await IMPORT(request("import", importBody()));
            expect(response.status).toBe(400);
            expect(await shared.db.aiConfiguration.count()).toBe(0);
            expect(readFileSync(keyFile).equals(invalidKey)).toBe(true);
        });
        it.each(["missing", "invalid"] as const)(
            "does not replace a %s key for an already persisted encrypted row",
            async (state) => {
                const before = await row();
                const keyFile = freshFileVault();
                const invalidKey = Buffer.alloc(7, 1);
                if (state === "invalid") writeFileSync(keyFile, invalidKey);
                for (const action of ["preview", "apply"] as const) {
                    const response = await IMPORT(
                        request("import", {
                            ...importBody(action),
                            revision: 1,
                            expires: Date.now() + 60000,
                            previewToken: "0".repeat(64),
                        }),
                    );
                    expect(response.status).toBe(400);
                    expect(await response.json()).toEqual({
                        message: state === "missing" ? "AI_MASTER_KEY_MISSING" : "AI_MASTER_KEY_INVALID",
                    });
                }
                expect(await row()).toEqual(before);
                expect(shared.legacy).not.toHaveBeenCalled();
                if (state === "invalid")
                    expect(readFileSync(keyFile).equals(invalidKey)).toBe(true);
                else expect(existsSync(keyFile)).toBe(false);
            },
        );
        it.each<Mode>(["merge", "replace"])(
            "creates revision one only after a valid first %s apply",
            async (mode) => {
                await shared.db.aiConfiguration.deleteMany();
                const initial = await store.loadAIConfig({ persist: false });
                const expected =
                    mode === "merge"
                        ? mergeConfig(initial.config, incoming)
                        : incoming;
                const approved = await preview(mode);
                expect(approved.revision).toBe(0);
                expect(approved.config).toEqual(masked(expected));
                expect(await shared.db.aiConfiguration.count()).toBe(0);
                await expectMaskedResponse(
                    await IMPORT(request("import", applyBody(approved, mode))),
                    expected,
                    1,
                );
                await expectStored(expected, 1);
            },
        );
        it("permits exactly one first apply even when both have verified revision zero before creating", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const approvals = await Promise.all([
                preview("replace", envelope),
                preview("replace", otherEnvelope),
            ]);
            expect(approvals.map((approval) => approval.revision)).toEqual([
                0, 0,
            ]);
            const realSave = store.saveAIConfig;
            let arrivals = 0;
            let release!: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            vi.spyOn(store, "saveAIConfig").mockImplementation(
                async (config, revision) => {
                    if (++arrivals === 2) release();
                    await gate;
                    return realSave(config, revision);
                },
            );
            const sources = [envelope, otherEnvelope];
            const responses = await Promise.all(
                approvals.map((approved, i) =>
                    IMPORT(
                        request(
                            "import",
                            applyBody(approved, "replace", sources[i]),
                        ),
                    ),
                ),
            );
            expect(responses.map((response) => response.status).sort()).toEqual(
                [200, 409],
            );
            const winner = responses.findIndex(
                (response) => response.status === 200,
            );
            await expectStored([incoming, alternative][winner], 1);
            expect(await shared.db.aiConfiguration.count()).toBe(1);
        });
        it("rejects a first preview after another caller initializes the legacy configuration", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const approved = await preview();
            expect(approved.revision).toBe(0);
            expect((await store.loadAIConfig()).revision).toBe(1);
            const before = await row();
            expect(
                (await IMPORT(request("import", applyBody(approved)))).status,
            ).toBe(409);
            expect(await row()).toEqual(before);
        });
        it("uses create-only CAS if legacy migration races after first-apply token verification", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const approved = await preview();
            expect(approved.revision).toBe(0);
            const realSave = store.saveAIConfig;
            vi.spyOn(store, "saveAIConfig").mockImplementationOnce(
                async (config, revision) => {
                    await store.loadAIConfig();
                    return realSave(config, revision);
                },
            );
            expect(
                (await IMPORT(request("import", applyBody(approved)))).status,
            ).toBe(409);
            const persisted = await row();
            expect(persisted.revision).toBe(1);
            const config = unprotect<PortableConfig>(persisted.payload);
            expect(config.providers).toHaveLength(1);
            expect(config.providers[0].baseUrl).toBe(
                "https://example.com/legacy/v1",
            );
        });
        it("rolls back the complete first insert if SQLite aborts after inserting the encrypted document", async () => {
            await shared.db.aiConfiguration.deleteMany();
            const approved = await preview();
            expect(approved.revision).toBe(0);
            await shared.db.$executeRawUnsafe(
                'CREATE TRIGGER "reject_config_write" AFTER INSERT ON "AiConfiguration" BEGIN SELECT RAISE(ABORT, \'SYNTHETIC_ATOMICITY_FAILURE\'); END',
            );
            const response = await IMPORT(
                request("import", applyBody(approved)),
            );
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                message: "IMPORT_STORAGE_UNAVAILABLE",
            });
            expect(await shared.db.aiConfiguration.count()).toBe(0);
        });
    },
);

describe.sequential("import preview token integrity", () => {
    it("cannot be used by a different currently authenticated administrator", async () => {
        const approved = await preview();
        const before = await row();
        shared.current = {
            id: "synthetic-admin-b",
            role: "admin",
            isActive: true,
        };
        expect(
            (await IMPORT(request("import", applyBody(approved)))).status,
        ).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("rejects different valid decrypted content under the same password", async () => {
        const approved = await preview();
        const before = await row();
        expect(
            (
                await IMPORT(
                    request(
                        "import",
                        applyBody(approved, "replace", otherEnvelope),
                    ),
                )
            ).status,
        ).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("cannot change merge to replace when that changes the approved content", async () => {
        const approved = await preview("merge");
        const before = await row();
        expect(
            (await IMPORT(request("import", applyBody(approved, "replace"))))
                .status,
        ).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("rejects a valid-length signature with one changed hex character", async () => {
        const approved = await preview();
        const before = await row();
        const token =
            (approved.previewToken[0] === "0" ? "1" : "0") +
            approved.previewToken.slice(1);
        const response = await IMPORT(
            request("import", { ...applyBody(approved), previewToken: token }),
        );
        expect(response.status).toBe(400);
        expect(await row()).toEqual(before);
    });
    it.each(["", "a".repeat(63), "g".repeat(64)])(
        "rejects malformed preview tokens (%s)",
        async (previewToken) => {
            const approved = await preview();
            const before = await row();
            expect(
                (
                    await IMPORT(
                        request("import", {
                            ...applyBody(approved),
                            previewToken,
                        }),
                    )
                ).status,
            ).toBe(409);
            expect(await row()).toEqual(before);
        },
    );
    it("binds the expiry timestamp in the signature, not just its allowed range", async () => {
        const approved = await preview();
        const before = await row();
        const response = await IMPORT(
            request("import", {
                ...applyBody(approved),
                expires: approved.expires - 1000,
            }),
        );
        expect(response.status).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("rejects an expired preview without writing", async () => {
        const approved = await preview();
        const before = await row();
        vi.spyOn(Date, "now").mockReturnValue(approved.expires + 1);
        expect(
            (await IMPORT(request("import", applyBody(approved)))).status,
        ).toBe(409);
        expect(await row()).toEqual(before);
    });
    it("rejects an expiry outside the five-minute acceptance window", async () => {
        const approved = await preview();
        const before = await row();
        const response = await IMPORT(
            request("import", {
                ...applyBody(approved),
                expires: Date.now() + 600000,
            }),
        );
        expect(response.status).toBe(409);
        expect(await row()).toEqual(before);
    });
    it("rejects a stale revision after another administrator saves", async () => {
        const approved = await preview();
        await store.saveAIConfig(alternative, 1);
        const before = await row();
        expect(
            (await IMPORT(request("import", applyBody(approved)))).status,
        ).toBe(409);
        expect(await row()).toEqual(before);
    });
    it("cannot bypass revision binding by editing the request to the new revision", async () => {
        const approved = await preview();
        await store.saveAIConfig(alternative, 1);
        const before = await row();
        const response = await IMPORT(
            request("import", { ...applyBody(approved), revision: 2 }),
        );
        expect(response.status).toBe(400);
        expect(await row()).toEqual(before);
    });
    it("cannot replay the same valid preview after a successful apply", async () => {
        const approved = await preview();
        expect(
            (await IMPORT(request("import", applyBody(approved)))).status,
        ).toBe(200);
        const before = await row();
        expect(
            (await IMPORT(request("import", applyBody(approved)))).status,
        ).toBe(409);
        expect(await row()).toEqual(before);
    });
});

describe.sequential(
    "configuration compare-and-swap and atomic persistence",
    () => {
        it("allows exactly one concurrent editor save and keeps the entire winning document", async () => {
            const candidates = [incoming, alternative];
            const responses = await Promise.all(
                candidates.map((config) =>
                    POST(request("config", { config, revision: 1 })),
                ),
            );
            expect(responses.map((response) => response.status).sort()).toEqual(
                [200, 409],
            );
            const winner = responses.findIndex(
                (response) => response.status === 200,
            );
            await expectStored(candidates[winner], 2);
        });
        it("allows exactly one of two concurrently applied previews for the same revision", async () => {
            const approvals = await Promise.all([
                preview("replace", envelope),
                preview("replace", otherEnvelope),
            ]);
            const sources = [envelope, otherEnvelope];
            const responses = await Promise.all(
                approvals.map((approved, index) =>
                    IMPORT(
                        request(
                            "import",
                            applyBody(approved, "replace", sources[index]),
                        ),
                    ),
                ),
            );
            expect(responses.map((response) => response.status).sort()).toEqual(
                [200, 409],
            );
            const winner = responses.findIndex(
                (response) => response.status === 200,
            );
            await expectStored([incoming, alternative][winner], 2);
        });
        it("checks revision again at persistence if a competitor writes after token verification", async () => {
            const approved = await preview();
            const realSave = store.saveAIConfig;
            vi.spyOn(store, "saveAIConfig").mockImplementationOnce(
                async (config, revision) => {
                    await realSave(alternative, revision);
                    return realSave(config, revision);
                },
            );
            const response = await IMPORT(
                request("import", applyBody(approved)),
            );
            expect(response.status).toBe(409);
            await expectStored(alternative, 2);
        });
        it.each(["save", "apply"] as const)(
            "rolls back both payload and revision when the SQLite %s statement aborts",
            async (operation) => {
                const approved = operation === "apply" ? await preview() : null;
                const before = await row();
                // AFTER UPDATE guarantees the fault is after row modification, not a
                // mocked pre-write exception. SQLite ABORT must undo the whole statement.
                await shared.db.$executeRawUnsafe(
                    'CREATE TRIGGER "reject_config_write" AFTER UPDATE ON "AiConfiguration" BEGIN SELECT RAISE(ABORT, \'SYNTHETIC_ATOMICITY_FAILURE\'); END',
                );
                const response = approved
                    ? await IMPORT(request("import", applyBody(approved)))
                    : await POST(
                          request("config", { config: incoming, revision: 1 }),
                      );
                expect(response.status).toBe(400);
                expect(await response.json()).toEqual({
                    message: operation === "apply" ? "IMPORT_STORAGE_UNAVAILABLE" : "INVALID_REQUEST_OR_CONFIGURATION",
                });
                expect(await row()).toEqual(before);
                await expectStored(current, 1);
            },
        );
    },
);

describe("saved configuration deduplication route", () => {
    const duplicates: PortableConfig = {
        ...current,
        providers: [...current.providers, { ...current.providers[0], id: "copy", name: "Copy" }],
        models: [...current.models, { ...current.models[0], id: "copy-model", providerId: "copy" }],
        chains: { text: ["copy-model", "model-current"], vision: ["model-current"] },
    };
    type Preview = import("@/lib/ai-config/deduplicate").DedupePreview;
    async function detect() {
        const res = await DEDUP(request("deduplicate", { action: "preview", choices: [] }));
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        const raw = await res.text();
        expect(raw).not.toContain(current.providers[0].apiKey);
        return JSON.parse(raw) as Preview;
    }
    const apply = (p: Preview, extra = {}) => DEDUP(request("deduplicate", {
        action: "apply", choices: [], revision: p.revision, expires: p.expires, nonce: p.nonce, previewToken: p.previewToken, ...extra,
    }));
    beforeEach(async () => { await shared.db.aiConfiguration.update({ where: { id: "site" }, data: { payload: protect(duplicates) } }); });
    it("compares keys only server-side and applies an approved preview once", async () => {
        const before = await row(), p = await detect();
        expect(await row()).toEqual(before);
        expect(p.before).toEqual(masked(duplicates)); expect(p.config).toEqual(masked(current));
        expect(p.endpoints).toEqual([{ connectionIds: ["provider-current", "copy"], keyGroups: [["provider-current", "copy"]], unknownIds: [] }]);
        const second = await detect(); expect(second.nonce).not.toBe(p.nonce); expect(second.previewToken).not.toBe(p.previewToken);
        const res = await apply(p); expect(res.headers.get("Cache-Control")).toBe("no-store");
        await expectMaskedResponse(res, current, 2); await expectStored(current, 2);
        expect((await apply(p)).status).toBe(409);
    });
    it.each([null, { id: "member", role: "user", isActive: true }, { id: "off", role: "admin", isActive: false }])("denies unauthorized detection and application", async user => {
        const p = await detect(), before = await row(); shared.current = user;
        for (const response of [await DEDUP(request("deduplicate", { action: "preview" })), await apply(p)]) {
            expect(response.status).toBe(user ? 403 : 401); expect(response.headers.get("Cache-Control")).toBe("no-store");
        }
        expect(await row()).toEqual(before);
    });
    it("rejects cross-origin requests, oversized bodies and unknown fields without writing", async () => {
        const before = await row();
        expect((await DEDUP(request("deduplicate", { action: "preview" }, { Origin: "https://other.invalid" }))).status).toBe(403);
        expect((await DEDUP(request("deduplicate", { action: "preview", padding: "a".repeat(70000) }))).status).toBe(413);
        expect((await DEDUP(request("deduplicate", { action: "preview", config: duplicates }))).status).toBe(400);
        expect((await DEDUP(request("deduplicate", { action: "preview", choices: [{kind:"connection",groupId:"invented",keepId:null}] }))).status).toBe(400);
        expect(await row()).toEqual(before);
    });
    it.each(["token", "nonce", "expires", "revision", "choices", "user"])("rejects tampered/expired/cross-user %s", async field => {
        const p = await detect(), before = await row(); const extra: Record<string, unknown> = {};
        if (field === "token") extra.previewToken = "0".repeat(64);
        if (field === "nonce") extra.nonce = "0".repeat(32);
        if (field === "expires") extra.expires = Date.now() - 1;
        if (field === "revision") extra.revision = 0;
        if (field === "choices") extra.choices = [{ kind: "connection", groupId: "provider-current", keepId: "copy" }];
        if (field === "user") shared.current = { id: "admin-b", role: "admin", isActive: true };
        const response = await apply(p, extra); expect([400, 409]).toContain(response.status);
        expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(await row()).toEqual(before);
    });
    it("requires re-preview of conflict choices, never unions capabilities", async () => {
        const c = structuredClone(duplicates); c.models[0].capabilities = ["vision"]; c.chains.text = ["copy-model"];
        await shared.db.aiConfiguration.update({ where: { id: "site" }, data: { payload: protect(c) } });
        const p = await detect(); expect(p.groups.find(g => g.kind === "model")?.keepId).toBeNull();
        const choices = [{ kind: "model", groupId: "model-current", keepId: "model-current" }];
        const response = await DEDUP(request("deduplicate", { action: "preview", choices }));
        expect(response.status).toBe(200); const selected = await response.json();
        expect(selected.config.chains.text).toEqual([]); expect((await apply(selected, { choices })).status).toBe(200);
        expect((await store.loadAIConfig()).config.models[0].capabilities).toEqual(["vision"]);
    });
    it("rejects an older preview after another administrator saves", async () => {
        const p = await detect(); await store.saveAIConfig(alternative, 1);
        expect((await apply(p)).status).toBe(409); await expectStored(alternative, 2);
    });
    it("uses the store CAS if a save races after snapshot loading", async () => {
        const p = await detect(), original = store.saveAIConfig;
        const spy = vi.spyOn(store, "saveAIConfig").mockImplementationOnce(async (config, revision) => {
            await original(alternative, revision); return original(config, revision);
        });
        try { expect((await apply(p)).status).toBe(409); await expectStored(alternative, 2); } finally { spy.mockRestore(); }
    });
    it("does not write on a no-op preview/application", async () => {
        await shared.db.aiConfiguration.update({ where: { id: "site" }, data: { payload: protect(current) } });
        const before = await row(), p = await detect(); expect(p.changed).toBe(false);
        expect((await apply(p)).status).toBe(409); expect(await row()).toEqual(before);
    });
    it("does not migrate or create a key on a fresh site", async () => {
        await shared.db.aiConfiguration.deleteMany(); const keyFile = freshFileVault();
        expect((await DEDUP(request("deduplicate", {action:"preview"}))).status).toBe(409);
        expect(await shared.db.aiConfiguration.count()).toBe(0); expect(existsSync(keyFile)).toBe(false);
    });
    it("never replaces a lost master key", async () => {
        const p = await detect(), before = await row(), keyFile = freshFileVault();
        expect((await apply(p)).status).toBe(400); expect(existsSync(keyFile)).toBe(false); expect(await row()).toEqual(before);
    });
    it("rolls back a failed SQLite apply and does not leak its error", async () => {
        const p = await detect(), before = await row();
        await shared.db.$executeRawUnsafe('CREATE TRIGGER "reject_config_write" AFTER UPDATE ON "AiConfiguration" BEGIN SELECT RAISE(ABORT, \'SYNTHETIC_ATOMICITY_FAILURE\'); END'.replaceAll("\\'", "'"));
        const response = await apply(p); expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ message: "INVALID_REQUEST_OR_CONFIGURATION" }); expect(await row()).toEqual(before);
    });
});

describe("import safe error classification", () => {
    it("reports a lost vault key independently of the export password", async () => {
        const file = freshFileVault();
        const response = await IMPORT(request("import", importBody()));
        expect(await response.json()).toEqual({ message: "AI_MASTER_KEY_MISSING" });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(existsSync(file)).toBe(false);
        expect((await row()).revision).toBe(1);
    });
    it("reports cross-origin rejection without exposing the configured origin", async () => {
        const response = await IMPORT(request("import", importBody(), { Origin: "https://other.invalid" }));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ message: "IMPORT_ORIGIN_REJECTED" });
    });
    it("distinguishes an unsupported envelope from authentication failure", async () => {
        const response = await IMPORT(request("import", { ...importBody(), envelope: { ...envelope, v: 9 } }));
        expect(await response.json()).toEqual({ message: "UNSUPPORTED_EXPORT" });
        const wrong = await IMPORT(request("import", { ...importBody(), password: PASSWORD + "wrong" }));
        expect(await wrong.json()).toEqual({ message: "INVALID_EXPORT_OR_PASSPHRASE" });
        await expectStored(current, 1);
    });
    it("does not expose storage exceptions or misdiagnose them as a bad password", async () => {
        const spy = vi.spyOn(store, "loadAIConfig").mockRejectedValueOnce(Error("synthetic-private-database-path"));
        try {
            const response = await IMPORT(request("import", importBody()));
            expect(await response.json()).toEqual({ message: "IMPORT_STORAGE_UNAVAILABLE" });
            await expectStored(current, 1);
        } finally { spy.mockRestore(); }
    });
});

it("returns safe field diagnostics after decryption without creating a key or configuration row", async () => {
    const { pbkdf2Sync } = await import("node:crypto");
    const { encryptWithKey } = await import("@/lib/ai-config/crypto");
    const salt = randomBytes(16);
    const invalid = fixture("invalid-http");
    invalid.providers[0].baseUrl = "http://example.com/v1?synthetic-private-value";
    const source = { ...envelope, salt: salt.toString("base64"), ...encryptWithKey(JSON.stringify(invalid), pbkdf2Sync(PASSWORD, salt, 300000, 32, "sha256")) };
    await shared.db.aiConfiguration.deleteMany();
    const file = freshFileVault();
    const response = await IMPORT(request("import", importBody("preview", "replace", source)));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "IMPORT_CONFIG_INCOMPATIBLE", issues: [{ path: "providers.0.baseUrl", reason: "URL_POLICY" }] });
    expect(existsSync(file)).toBe(false);
    expect(await shared.db.aiConfiguration.count()).toBe(0);
    expect(shared.legacy).not.toHaveBeenCalled();
});


describe("administrator portable export", () => {
    const exportRequest = (body = {password: PASSWORD, revision: 1}, headers = {}) =>
        new Request(`${ORIGIN}/api/ai/config/export`, {method: "POST", headers: {"content-type": "application/json", Origin: ORIGIN, ...headers}, body: JSON.stringify(body)});
    const runExport = async (req: Request) => (await import("@/app/api/ai/config/export/route")).POST(req);
    it("exports only encrypted saved AI config, roundtrips into import, with no writes", async () => {
        const before = await row();
        const response = await runExport(exportRequest());
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("content-disposition")).toContain("attachment;");
        const text = await response.text();
        expect(text).not.toContain(current.providers[0].apiKey);
        expect(text).not.toContain(PASSWORD);
        const envelope = JSON.parse(text);
        expect(await openExport(envelope, PASSWORD)).toEqual(current);
        const result = await IMPORT(request("import", {action: "preview", mode: "replace", password: PASSWORD, envelope}));
        expect(result.status).toBe(200);
        expect(await row()).toEqual(before);
    });
    it("denies nonadmin and foreign origins before reading body or config", async () => {
        for (const role of [null, "user", "admin"] as const) {
            shared.current = role ? {id: "synthetic", role, isActive: true} : null;
            const req = exportRequest(undefined, role === "admin" ? {Origin: "https://foreign.invalid"} : {});
            const read = vi.spyOn(req, "body", "get");
            const load = vi.spyOn(store, "loadAIConfig");
            try {
                const response = await runExport(req);
                expect(response.status).toBe(role ? 403 : 401);
                expect(response.headers.get("cache-control")).toBe("no-store");
                expect(read).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
            } finally {read.mockRestore(); load.mockRestore();}
        }
    });
    it("rejects stale revision, invalid content type and short passwords without exporting", async () => {
        expect((await runExport(exportRequest({password: PASSWORD, revision: 0}))).status).toBe(409);
        expect((await runExport(exportRequest({password: "short", revision: 1}))).status).toBe(400);
        expect((await runExport(exportRequest(undefined, {"content-type": "text/plain"}))).status).toBe(415);
        await expectStored(current, 1);
    });
    it("does not initialize storage or a master key when exporting legacy config", async () => {
        await shared.db.aiConfiguration.deleteMany(); const file = freshFileVault();
        shared.legacy.mockReturnValue({aiProvider: "openai", openai: {instances: [{id: "fixture", name: "Fixture", apiKey: "synthetic-legacy-only", baseUrl: "https://example.com/v1", model: "synthetic"}]}});
        const response = await runExport(exportRequest({password: PASSWORD, revision: 0}));
        expect(response.status).toBe(200);
        expect(existsSync(file)).toBe(false);
        expect((await openExport(await response.json(), PASSWORD)).providers[0].apiKey).toBe("synthetic-legacy-only");
        expect(await shared.db.aiConfiguration.count()).toBe(0);
    });
    it("rejects oversized/chunked bodies before reading saved keys", async () => {
        const load = vi.spyOn(store, "loadAIConfig");
        try {
            for (const headers of [{}, {"content-length": "9000"}]) {
                const req = exportRequest({password: "x".repeat(9000), revision: 1}, headers);
                const response = await runExport(req);
                expect(response.status).toBe(413);
                expect(await response.json()).toEqual({message:"BODY_TOO_LARGE"});
            }
            expect(load).not.toHaveBeenCalled();
        } finally {load.mockRestore();}
    });
    it("uses fresh salt/IV and keeps the exported snapshot immutable", async () => {
        const before=await row();
        const a=await (await runExport(exportRequest())).json();
        const b=await (await runExport(exportRequest())).json();
        expect(a.salt).not.toBe(b.salt); expect(a.iv).not.toBe(b.iv);
        expect(await openExport(a,PASSWORD)).toEqual(await openExport(b,PASSWORD));
        expect(await row()).toEqual(before);
    });
    it("never leaks vault errors or configuration values", async () => {
        const spy = vi.spyOn(store, "loadAIConfig").mockRejectedValueOnce(Error("synthetic-private-value"));
        try {
            const response = await runExport(exportRequest());
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({message: "INVALID_REQUEST_OR_CONFIGURATION"});
        } finally {spy.mockRestore();}
    });
});

describe("admin-only origin diagnostic", () => {
    const get = async () => (await import("@/app/api/ai/config/origin/route")).GET(new Request("http://internal:3000/api/ai/config/origin", {headers: {"X-Forwarded-Host": "forged.invalid"}}));
    it("reports the explicit canonical origin, never internal or forwarded hosts", async () => {
        vi.stubEnv("NEXTAUTH_URL", ORIGIN + "/api/auth?private=value");
        const response = await get(); expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({state: "configured", canonicalOrigin: ORIGIN});
    });
    it("distinguishes missing and invalid config without disclosing invalid values", async () => {
        vi.stubEnv("NEXTAUTH_URL", ""); expect(await (await get()).json()).toEqual({state: "missing", canonicalOrigin: null});
        vi.stubEnv("NEXTAUTH_URL", "https://private:private@example.invalid");
        expect(await (await get()).json()).toEqual({state: "invalid", canonicalOrigin: null});
    });
    it("does not expose the deployment address to ordinary users", async () => {
        shared.current = {id: "synthetic", role: "user", isActive: true};
        const response = await get(); expect(response.status).toBe(403);
        expect(await response.text()).not.toContain(ORIGIN);
    });
});
