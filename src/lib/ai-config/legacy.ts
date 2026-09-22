import type { AppConfig } from "../config";
import {
    emptyConfig,
    ModelSchema,
    parseConfig,
    ProviderSchema,
    type PortableConfig,
} from "./schema";

// Keep these limits aligned with ConfigSchema. Stored models need not all be in
// a fallback chain; extra compatible models remain available in management.
const MAX_PROVIDERS = 50;
const MAX_MODELS = 200;
const MAX_CHAIN_ENTRIES = 30;
const SKIPPED_WARNING =
    "Legacy AI migration skipped incompatible or excess entries.";

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function withDefault(value: unknown, fallback: string): unknown {
    // Only absent/empty legacy fields get defaults. Invalid non-string values
    // must not silently become a different endpoint, model or provider name.
    return value === undefined || value === null || value === ""
        ? fallback
        : value;
}

function parseEntry<T>(
    schema: {
        safeParse(
            value: unknown,
        ): { success: true; data: T } | { success: false };
    },
    value: unknown,
): T | undefined {
    try {
        const result = schema.safeParse(value);
        return result.success ? result.data : undefined;
    } catch {
        // Refinements can throw (for example URL construction). Treat this as
        // an invalid entry too; never log errors containing legacy input.
        return undefined;
    }
}

// No overwrite of the legacy JSON: it is the explicit rollback source.
export function migrateLegacy(c: AppConfig): PortableConfig {
    const source = record(c);
    const out = emptyConfig();
    const skipped = { providers: 0, models: 0, chainEntries: 0 };
    const add = (
        id: string,
        name: unknown,
        protocol: "chat" | "gemini" | "azure",
        baseUrl: unknown,
        apiKey: unknown,
        model: unknown,
        apiVersion?: unknown,
    ): boolean => {
        if (!apiKey || out.providers.length >= MAX_PROVIDERS) {
            skipped.providers++;
            skipped.models++;
            return false;
        }
        const provider = parseEntry(ProviderSchema, {
            id,
            name,
            protocol,
            baseUrl,
            apiKey,
            enabled: true,
            ...(apiVersion !== undefined ? { apiVersion } : {}),
        });
        if (!provider) {
            // A model cannot survive the rejection of its referenced provider.
            skipped.providers++;
            skipped.models++;
            return false;
        }
        out.providers.push(provider);
        const candidateModel = parseEntry(ModelSchema, {
            id: `${id}:default`,
            providerId: id,
            name,
            model,
            capabilities: ["text", "vision"],
            enabled: true,
        });
        if (candidateModel && out.models.length < MAX_MODELS) {
            out.models.push(candidateModel);
        } else {
            // Keep a valid provider so its model can be corrected in management.
            skipped.models++;
        }
        return true;
    };

    if (source.aiProvider === "openai") {
        const openai = record(source.openai);
        const instances = openai.instances;
        if (Array.isArray(instances)) {
            const active =
                typeof openai.activeInstanceId === "string" &&
                openai.activeInstanceId
                    ? instances.findIndex(
                          (p) => record(p).id === openai.activeInstanceId,
                      )
                    : -1;
            const positions = new Map<string, number>();
            const addInstance = (index: number) => {
                const p = record(instances[index]);
                const id = `legacy-${index}`;
                if (
                    add(
                        id,
                        withDefault(p.name, `OpenAI ${index + 1}`),
                        "chat",
                        withDefault(p.baseUrl, "https://api.openai.com/v1"),
                        p.apiKey,
                        p.model,
                    )
                ) {
                    positions.set(id, index);
                }
            };
            // Reserve capacity for the active entry before applying total limits.
            if (active >= 0) addInstance(active);
            for (let index = 0; index < instances.length; index++) {
                if (index !== active) addInstance(index);
            }
            // Providers retain source order; models/chains retain active-first
            // order followed by the remaining compatible entries in source order.
            out.providers.sort(
                (a, b) => positions.get(a.id)! - positions.get(b.id)!,
            );
        } else if (instances !== undefined && instances !== null) {
            skipped.providers++;
            skipped.models++;
        }
    } else if (source.aiProvider === "azure") {
        const azure = record(source.azure);
        if (azure.apiKey) {
            add(
                "legacy-azure",
                "Azure",
                "azure",
                azure.endpoint,
                azure.apiKey,
                azure.deploymentName,
                withDefault(azure.apiVersion, "2024-10-21"),
            );
        }
    } else {
        const gemini = record(source.gemini);
        if (gemini.apiKey) {
            add(
                "legacy-gemini",
                "Gemini",
                "gemini",
                withDefault(
                    gemini.baseUrl,
                    "https://generativelanguage.googleapis.com",
                ),
                gemini.apiKey,
                withDefault(gemini.model, "gemini-2.5-flash"),
            );
        }
    }

    out.chains.text = out.models
        .slice(0, MAX_CHAIN_ENTRIES)
        .map((model) => model.id);
    out.chains.vision = [...out.chains.text];
    skipped.chainEntries = (out.models.length - out.chains.text.length) * 2;
    if (skipped.providers || skipped.models || skipped.chainEntries) {
        console.warn(SKIPPED_WARNING, skipped);
    }
    return parseConfig(out);
}
