import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, OpenAIInstance } from "../../../lib/config";
import { migrateLegacy } from "../../../lib/ai-config/legacy";
import {
    emptyConfig,
    parseConfig,
    type PortableConfig,
} from "../../../lib/ai-config/schema";

// Pure in-memory fixtures only. The migration's AppConfig import is type-only;
// no getAppConfig(), real JSON, environment, database or network is accessed.
const fixtureKey = ["synthetic", "legacy", "credential"].join("-");
const warning = "Legacy AI migration skipped incompatible or excess entries.";

function instance(
    index: number,
    overrides: Record<string, unknown> = {},
): OpenAIInstance {
    return {
        id: `source-${index}`,
        name: `Synthetic provider ${index}`,
        baseUrl: `https://provider-${index}.example.invalid/v1`,
        apiKey: fixtureKey,
        model: `synthetic-model-${index}`,
        ...overrides,
    } as OpenAIInstance;
}

function openai(instances: unknown[], activeInstanceId?: string): AppConfig {
    return {
        aiProvider: "openai",
        openai: { instances, activeInstanceId },
    } as AppConfig;
}

function modelId(index: number) {
    return `legacy-${index}:default`;
}
function providerId(index: number) {
    return `legacy-${index}`;
}

function expectValid(config: PortableConfig) {
    expect(() => parseConfig(config)).not.toThrow();
    expect(config.chains.text).toEqual(config.chains.vision);
    expect(
        config.chains.text.every((id) =>
            config.models.some((model) => model.id === id),
        ),
    ).toBe(true);
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
    // Enforce a count-only warning contract; never permit raw schema errors,
    // provider names, endpoints, credentials or even selected identifiers.
    try {
        for (const [message, counts, ...rest] of vi.mocked(console.warn).mock
            .calls) {
            expect(message).toBe(warning);
            expect(rest).toEqual([]);
            expect(Object.keys(counts).sort()).toEqual([
                "chainEntries",
                "models",
                "providers",
            ]);
            expect(
                Object.values(counts).every(
                    (value) =>
                        Number.isInteger(value) && (value as number) >= 0,
                ),
            ).toBe(true);
        }
        for (const method of ["log", "error", "info", "debug"] as const) {
            expect(console[method]).not.toHaveBeenCalled();
        }
    } finally {
        vi.restoreAllMocks();
    }
});

describe("legacy AI migration: per-entry validation", () => {
    it("preserves all valid entries and active-first model/chain ordering without mutating the source", () => {
        const source = deepFreeze(
            openai([instance(0), instance(1), instance(2)], "source-1"),
        );
        const before = JSON.stringify(source);
        const result = migrateLegacy(source);

        expect(result.providers.map((p) => p.id)).toEqual([
            providerId(0),
            providerId(1),
            providerId(2),
        ]);
        expect(result.models.map((m) => m.id)).toEqual([
            modelId(1),
            modelId(0),
            modelId(2),
        ]);
        expect(result.chains.text).toEqual([
            modelId(1),
            modelId(0),
            modelId(2),
        ]);
        expect(result.providers[1]).toMatchObject({
            apiKey: fixtureKey,
            baseUrl: instance(1).baseUrl,
            name: instance(1).name,
        });
        expect(result.models[0]).toMatchObject({
            model: instance(1).model,
            capabilities: ["text", "vision"],
        });
        expect(JSON.stringify(source) === before).toBe(true);
        expect(console.warn).not.toHaveBeenCalled();
        expectValid(result);
    });

    it.each([
        ["HTTP endpoint", { baseUrl: "http://insecure.example.invalid/v1" }],
        [
            "malformed endpoint with a throwing URL refinement",
            { baseUrl: "not a URL" },
        ],
        [
            "URL credentials",
            {
                baseUrl:
                    "https://synthetic:fixture@provider.example.invalid/v1",
            },
        ],
        [
            "URL query",
            {
                baseUrl:
                    "https://provider.example.invalid/v1?credential=fixture",
            },
        ],
        [
            "URL fragment",
            { baseUrl: "https://provider.example.invalid/v1#fixture" },
        ],
        [
            "oversized endpoint",
            { baseUrl: `https://provider.example.invalid/${"x".repeat(2048)}` },
        ],
        ["oversized credential", { apiKey: "x".repeat(16385) }],
        ["oversized name", { name: "n".repeat(101) }],
        ["non-string endpoint", { baseUrl: 23 }],
        ["falsy non-string endpoint", { baseUrl: false }],
        ["non-string credential", { apiKey: { synthetic: true } }],
        ["non-string name", { name: ["synthetic"] }],
    ])(
        "skips a provider with %s but keeps every valid neighbor",
        (_label, overrides) => {
            const source = deepFreeze(
                openai(
                    [instance(0), instance(1, overrides), instance(2)],
                    "source-2",
                ),
            );
            const before = JSON.stringify(source);
            const result = migrateLegacy(source);

            expect(result.providers.map((p) => p.id)).toEqual([
                providerId(0),
                providerId(2),
            ]);
            expect(result.models.map((m) => m.id)).toEqual([
                modelId(2),
                modelId(0),
            ]);
            expect(result.chains.text).toEqual([modelId(2), modelId(0)]);
            expect(JSON.stringify(source) === before).toBe(true);
            expect(console.warn).toHaveBeenCalledExactlyOnceWith(warning, {
                providers: 1,
                models: 1,
                chainEntries: 0,
            });
            expectValid(result);
        },
    );

    it.each([
        ["oversized model", "m".repeat(201)],
        ["empty model", ""],
        ["missing model", undefined],
        ["non-string model", { synthetic: true }],
    ])("keeps a valid provider but skips its %s", (_label, model) => {
        const result = migrateLegacy(
            openai(
                [instance(0), instance(1, { model }), instance(2)],
                "source-1",
            ),
        );

        expect(result.providers.map((p) => p.id)).toEqual([
            providerId(0),
            providerId(1),
            providerId(2),
        ]);
        expect(result.models.map((m) => m.id)).toEqual([
            modelId(0),
            modelId(2),
        ]);
        expect(result.chains.text).toEqual([modelId(0), modelId(2)]);
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(warning, {
            providers: 0,
            models: 1,
            chainEntries: 0,
        });
        expectValid(result);
    });

    it.each([
        ["null", null],
        ["number", 42],
        ["string", "synthetic"],
        ["boolean", false],
        ["array", []],
        ["empty object", {}],
    ])("isolates a malformed instance (%s)", (_label, bad) => {
        const result = migrateLegacy(
            openai([instance(0), bad, instance(2)], "source-2"),
        );
        expect(result.providers.map((p) => p.id)).toEqual([
            providerId(0),
            providerId(2),
        ]);
        expect(result.chains.text).toEqual([modelId(2), modelId(0)]);
        expectValid(result);
    });

    it("drops an invalid active provider without reversing the remaining fallbacks", () => {
        const result = migrateLegacy(
            openai(
                [
                    instance(0),
                    instance(1, { baseUrl: "http://insecure.example.invalid" }),
                    instance(2),
                ],
                "source-1",
            ),
        );
        expect(result.chains.text).toEqual([modelId(0), modelId(2)]);
        expectValid(result);
    });

    it("preserves source order when the active ID is absent or no longer exists", () => {
        for (const active of [undefined, "missing-source-id"]) {
            const result = migrateLegacy(
                openai([instance(0), instance(1)], active),
            );
            expect(result.chains.text).toEqual([modelId(0), modelId(1)]);
        }
    });

    it("retains safe legacy defaults for an omitted endpoint and name", () => {
        const result = migrateLegacy(
            openai([instance(0, { baseUrl: "", name: "" })]),
        );
        expect(result.providers[0]).toMatchObject({
            baseUrl: "https://api.openai.com/v1",
            name: "OpenAI 1",
        });
        expect(console.warn).not.toHaveBeenCalled();
        expectValid(result);
    });
});

describe("legacy AI migration: bounded output", () => {
    it("caps chains at thirty without discarding valid models or an active model beyond the chain boundary", () => {
        const result = migrateLegacy(
            openai(
                Array.from({ length: 35 }, (_, i) => instance(i)),
                "source-34",
            ),
        );
        expect(result.providers).toHaveLength(35);
        expect(result.models).toHaveLength(35);
        expect(result.chains.text).toEqual([
            modelId(34),
            ...Array.from({ length: 29 }, (_, i) => modelId(i)),
        ]);
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(warning, {
            providers: 0,
            models: 0,
            chainEntries: 10,
        });
        expectValid(result);
    });

    it("reserves capacity for the active provider beyond the provider limit and keeps stable source IDs", () => {
        const source = deepFreeze(
            openai(
                Array.from({ length: 61 }, (_, i) => instance(i)),
                "source-60",
            ),
        );
        const before = JSON.stringify(source);
        const result = migrateLegacy(source);

        expect(result.providers.map((p) => p.id)).toEqual([
            ...Array.from({ length: 49 }, (_, i) => providerId(i)),
            providerId(60),
        ]);
        expect(result.models.map((m) => m.id)).toEqual([
            modelId(60),
            ...Array.from({ length: 49 }, (_, i) => modelId(i)),
        ]);
        expect(result.chains.text).toEqual([
            modelId(60),
            ...Array.from({ length: 29 }, (_, i) => modelId(i)),
        ]);
        expect(result.models.length).toBeLessThanOrEqual(200);
        expect(JSON.stringify(source) === before).toBe(true);
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(warning, {
            providers: 11,
            models: 11,
            chainEntries: 40,
        });
        expectValid(result);
    });

    it("does not let invalid early providers consume the schema capacity", () => {
        const instances = Array.from({ length: 60 }, (_, i) =>
            instance(i, { baseUrl: "http://insecure.example.invalid" }),
        );
        instances.push(
            ...Array.from({ length: 55 }, (_, i) => instance(i + 60)),
        );
        const result = migrateLegacy(openai(instances, "source-114"));
        expect(result.providers.map((p) => p.id)).toEqual([
            ...Array.from({ length: 49 }, (_, i) => providerId(i + 60)),
            providerId(114),
        ]);
        expect(result.chains.text[0]).toBe(modelId(114));
        expectValid(result);
    });
});

describe("legacy AI migration: alternate selected backends", () => {
    it.each(["azure", "gemini"] as const)(
        "keeps a valid %s configuration",
        (aiProvider) => {
            const config: AppConfig =
                aiProvider === "azure"
                    ? {
                          aiProvider,
                          azure: {
                              apiKey: fixtureKey,
                              endpoint: "https://azure.example.invalid",
                              deploymentName: "synthetic-deployment",
                          },
                      }
                    : { aiProvider, gemini: { apiKey: fixtureKey } };
            const result = migrateLegacy(deepFreeze(config));
            expect(result.providers).toHaveLength(1);
            expect(result.providers[0].protocol).toBe(aiProvider);
            expect(result.models).toHaveLength(1);
            expect(result.chains.text).toEqual([
                `legacy-${aiProvider}:default`,
            ]);
            expect(console.warn).not.toHaveBeenCalled();
            expectValid(result);
        },
    );

    it.each([
        [
            "Azure HTTP",
            {
                aiProvider: "azure",
                azure: {
                    endpoint: "http://azure.example.invalid",
                    apiKey: fixtureKey,
                    deploymentName: "synthetic",
                },
            },
        ],
        [
            "Azure API version length",
            {
                aiProvider: "azure",
                azure: {
                    endpoint: "https://azure.example.invalid",
                    apiKey: fixtureKey,
                    deploymentName: "synthetic",
                    apiVersion: "v".repeat(81),
                },
            },
        ],
        [
            "Gemini HTTP",
            {
                aiProvider: "gemini",
                gemini: {
                    baseUrl: "http://gemini.example.invalid",
                    apiKey: fixtureKey,
                },
            },
        ],
        [
            "Gemini malformed URL",
            {
                aiProvider: "gemini",
                gemini: { baseUrl: "invalid", apiKey: fixtureKey },
            },
        ],
    ])(
        "skips an incompatible %s provider without preventing management/import",
        (_label, config) => {
            const result = migrateLegacy(config as AppConfig);
            expect(result).toEqual(emptyConfig());
            expectValid(result);
        },
    );

    it.each(["azure", "gemini"] as const)(
        "keeps a valid %s provider when only its model exceeds the limit",
        (aiProvider) => {
            const config: AppConfig =
                aiProvider === "azure"
                    ? {
                          aiProvider,
                          azure: {
                              endpoint: "https://azure.example.invalid",
                              apiKey: fixtureKey,
                              deploymentName: "m".repeat(201),
                          },
                      }
                    : {
                          aiProvider,
                          gemini: {
                              apiKey: fixtureKey,
                              model: "m".repeat(201),
                          },
                      };
            const result = migrateLegacy(config);
            expect(result.providers).toHaveLength(1);
            expect(result.models).toEqual([]);
            expect(result.chains.text).toEqual([]);
            expectValid(result);
        },
    );
});

describe("legacy AI migration: usable empty result", () => {
    it.each([
        ["empty root", {}],
        ["null root", null],
        ["missing instances", { aiProvider: "openai" }],
        [
            "empty instances",
            { aiProvider: "openai", openai: { instances: [] } },
        ],
        [
            "malformed instances collection",
            { aiProvider: "openai", openai: { instances: { bad: true } } },
        ],
        ["empty Azure", { aiProvider: "azure", azure: {} }],
        ["empty Gemini", { aiProvider: "gemini", gemini: {} }],
        [
            "all rejected instances",
            openai([
                instance(0, { baseUrl: "http://insecure.example.invalid" }),
            ]),
        ],
    ])("returns an importable empty config for %s", (_label, config) => {
        const result = migrateLegacy(config as AppConfig);
        expect(result).toEqual(emptyConfig());
        expectValid(result);
    });
});
