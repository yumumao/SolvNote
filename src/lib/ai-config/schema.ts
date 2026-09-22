import { z } from "zod";
const id = z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z0-9_.:@/-]+$/);
export const ProviderSchema = z.object({
    id: id.max(80),
    name: z.string().min(1).max(100),
    protocol: z.enum([
        "chat",
        "responses",
        "responses_codex",
        "gemini",
        "azure",
    ]),
    baseUrl: z
        .string()
        .url()
        .max(2048)
        .refine((v) => {
            let u: URL;
            try { u = new URL(v); } catch { return false; }
            return (
                u.protocol === "https:" &&
                !u.username &&
                !u.password &&
                !u.search &&
                !u.hash
            );
        }, "Use a public HTTPS API URL without credentials/query"),
    apiKey: z.string().max(16384).default(""),
    enabled: z.boolean().default(true),
    apiVersion: z.string().max(80).optional(),
});
export const ModelSchema = z.object({
    id,
    providerId: id.max(80),
    // ScanDex uses the exact upstream model (up to 200 chars) as its display name.
    name: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    capabilities: z
        .array(z.enum(["text", "vision"]))
        .min(1)
        .max(2),
    enabled: z.boolean().default(true),
});
export const ConfigSchema = z
    .object({
        version: z.literal(1),
        providers: z.array(ProviderSchema).max(50),
        models: z.array(ModelSchema).max(200),
        chains: z.object({
            text: z.array(id).max(30),
            vision: z.array(id).max(30),
        }),
    })
    .superRefine((c, ctx) => {
        const ps = new Set(c.providers.map((p) => p.id)),
            ms = new Set(c.models.map((m) => m.id));
        if (ps.size !== c.providers.length || ms.size !== c.models.length)
            ctx.addIssue({ code: "custom", message: "Duplicate IDs" });
        for (const m of c.models)
            if (!ps.has(m.providerId))
                ctx.addIssue({
                    code: "custom",
                    message: "Unknown provider reference",
                });
        for (const kind of ["text", "vision"] as const) {
            if (new Set(c.chains[kind]).size !== c.chains[kind].length)
                ctx.addIssue({
                    code: "custom",
                    message: "Duplicate chain entry",
                });
            for (const mid of c.chains[kind]) {
                const m = c.models.find((x) => x.id === mid);
                const p = c.providers.find((x) => x.id === m?.providerId);
                if (
                    !m ||
                    !p ||
                    !m.enabled ||
                    !p.enabled ||
                    !m.capabilities.includes(kind)
                )
                    ctx.addIssue({
                        code: "custom",
                        message: `Invalid ${kind} chain reference`,
                    });
            }
        }
    });
export type PortableConfig = z.infer<typeof ConfigSchema>;
export type AIProvider = z.infer<typeof ProviderSchema>;
export type AIModel = z.infer<typeof ModelSchema>;
export const emptyConfig = (): PortableConfig => ({
    version: 1,
    providers: [],
    models: [],
    chains: { text: [], vision: [] },
});
export function parseConfig(v: unknown): PortableConfig {
    return ConfigSchema.parse(v);
}
export function mergeConfig(
    current: PortableConfig,
    incoming: PortableConfig,
): PortableConfig {
    const providers = [
        ...new Map(
            [...current.providers, ...incoming.providers].map((p) => [p.id, p]),
        ).values(),
    ];
    const models = [
        ...new Map(
            [...current.models, ...incoming.models].map((m) => [m.id, m]),
        ).values(),
    ];
    const chain = (k: "text" | "vision") =>
        [...new Set([...incoming.chains[k], ...current.chains[k]])].filter(
            (id) => {
                const m = models.find((x) => x.id === id);
                return (
                    m?.enabled &&
                    m.capabilities.includes(k) &&
                    providers.find((p) => p.id === m.providerId)?.enabled
                );
            },
        );
    return parseConfig({
        version: 1,
        providers,
        models,
        chains: { text: chain("text"), vision: chain("vision") },
    });
}
export function redactConfig(c: PortableConfig) {
    return {
        ...c,
        providers: c.providers.map((p) => ({
            ...p,
            apiKey: p.apiKey ? "********" : "",
        })),
    };
}
