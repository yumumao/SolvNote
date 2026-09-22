import { parseConfig, type AIProvider, type PortableConfig } from "./schema";

export type MergeChoice = { kind: "connection" | "model"; groupId: string; keepId: string | null };
export type MergeGroup = MergeChoice & {
    conflict: boolean;
    members: { id: string; label: string; enabled: boolean; capabilities?: string[] }[];
};
export type EndpointKeys = { connectionIds: string[]; keyGroups: string[][]; unknownIds: string[] };
export type DedupePreview = {
    before: PortableConfig;
    config: PortableConfig;
    groups: MergeGroup[];
    endpoints: EndpointKeys[];
    changed: boolean;
    revision: number;
    expires: number;
    nonce: string;
    previewToken: string;
};

// Server-only callers supply decrypted configurations, never a browser's masks.
const usableKey = (key: string) => !!key.trim() && !/^\*+$/.test(key);
const endpoint = (p: AIProvider) => new URL(p.baseUrl).href.replace(/\/+$/, "");
const signature = (p: AIProvider) => JSON.stringify([endpoint(p), p.protocol, p.apiVersion ?? "", p.apiKey]);
function buckets<T>(items: T[], key: (item: T) => string): T[][] {
    const groups = new Map<string, T[]>();
    for (const item of items) { const k = key(item); const group = groups.get(k) ?? []; group.push(item); groups.set(k, group); }
    return [...groups.values()];
}

/** Pure transformation: no IO, no mutation, no capacity/capability union. */
export function deduplicateConfig(input: PortableConfig, choices: MergeChoice[] = []) {
    const config = parseConfig(input);
    const selections = new Map<string, MergeChoice>();
    for (const choice of choices) {
        const key = JSON.stringify([choice.kind, choice.groupId]);
        if (selections.has(key)) throw Error("INVALID_REQUEST");
        selections.set(key, choice);
    }
    const groups: MergeGroup[] = [];
    const choose = (kind: MergeChoice["kind"], members: MergeGroup["members"], conflict: boolean) => {
        const groupId = members[0].id, key = JSON.stringify([kind, groupId]);
        const choice = selections.get(key);
        const keepId = choice ? choice.keepId : conflict ? null : groupId;
        if (keepId !== null && !members.some(m => m.id === keepId)) throw Error("INVALID_REQUEST");
        selections.delete(key);
        groups.push({ kind, groupId, keepId, members, conflict });
        return keepId;
    };
    // Return credential equivalence classes as IDs, never keys or key fingerprints.
    const endpoints: EndpointKeys[] = buckets(config.providers, endpoint).filter(ps => ps.length > 1).map(ps => ({
        connectionIds: ps.map(p => p.id),
        keyGroups: buckets(ps.filter(p => usableKey(p.apiKey)), p => p.apiKey).map(g => g.map(p => p.id)),
        unknownIds: ps.filter(p => !usableKey(p.apiKey)).map(p => p.id),
    }));
    const providerMap = new Map(config.providers.map(p => [p.id, p.id]));
    for (const ps of buckets(config.providers.filter(p => usableKey(p.apiKey)), signature).filter(g => g.length > 1)) {
        const keep = choose("connection", ps.map(p => ({ id: p.id, label: p.name, enabled: p.enabled })), ps.some(p => p.enabled !== ps[0].enabled));
        if (keep) for (const p of ps) providerMap.set(p.id, keep);
    }
    const providers = config.providers.filter(p => providerMap.get(p.id) === p.id);
    const relocated = config.models.map(m => ({ ...m, providerId: providerMap.get(m.providerId)! }));
    const modelMap = new Map(relocated.map(m => [m.id, m.id]));
    for (const ms of buckets(relocated, m => JSON.stringify([m.providerId, m.model])).filter(g => g.length > 1)) {
        const semantic = (m: typeof ms[number]) => JSON.stringify([m.enabled, [...new Set(m.capabilities)].sort()]);
        const keep = choose("model", ms.map(m => ({ id: m.id, label: `${m.name} · ${m.model}`, enabled: m.enabled, capabilities: m.capabilities })), ms.some(m => semantic(m) !== semantic(ms[0])));
        if (keep) for (const m of ms) modelMap.set(m.id, keep);
    }
    if (selections.size) throw Error("INVALID_REQUEST"); // Stale/invented groups fail closed.
    const models = relocated.filter(m => modelMap.get(m.id) === m.id);
    const chain = (kind: "text" | "vision") => [...new Set(config.chains[kind].map(id => modelMap.get(id)!))].filter(id => {
        const model = models.find(m => m.id === id)!;
        return model.enabled && model.capabilities.includes(kind) && providers.find(p => p.id === model.providerId)!.enabled;
    });
    const result = parseConfig({ version: 1, providers, models, chains: { text: chain("text"), vision: chain("vision") } });
    return { config: result, groups, endpoints, changed: JSON.stringify(result) !== JSON.stringify(config) };
}
