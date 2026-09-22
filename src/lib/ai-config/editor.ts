import type { AIModel, PortableConfig } from "./schema";

export type InputKind = "text" | "vision";
export const inputKinds: InputKind[] = ["text", "vision"];
export function eligible(config: PortableConfig, model: AIModel, kind: InputKind) {
    return model.enabled && model.capabilities.includes(kind) &&
        !!config.providers.find((p) => p.id === model.providerId)?.enabled;
}

/** One connection per credential; never copy a stored-key mask into a new ID. */
export function anotherKey(config: PortableConfig, providerId: string, newId: string): PortableConfig {
    const source = config.providers.find((p) => p.id === providerId);
    if (!source) return config;
    return { ...config, providers: [...config.providers, {
        ...source, id: newId, name: `${source.name} · 另一把Key`, apiKey: "",
    }] };
}

export function chainsFromOrder(config: PortableConfig, order: string[]): PortableConfig["chains"] {
    const unique = [...new Set(order)];
    const select = (kind: InputKind) => unique.filter((id) => {
        const model = config.models.find((m) => m.id === id);
        return model && eligible(config, model, kind);
    });
    return { text: select("text"), vision: select("vision") };
}

/** Only infer a shared order if BOTH chains, including membership, round-trip exactly. */
export function inferSharedOrder(config: PortableConfig): string[] | null {
    const ids = [...new Set([...config.chains.text, ...config.chains.vision])];
    const edges = new Map(ids.map((id) => [id, new Set<string>()]));
    const degrees = new Map(ids.map((id) => [id, 0]));
    for (const kind of inputKinds) {
        const chain = config.chains[kind];
        for (let i = 1; i < chain.length; i++) {
            const edge = edges.get(chain[i - 1])!;
            if (!edge.has(chain[i])) {
                edge.add(chain[i]);
                degrees.set(chain[i], degrees.get(chain[i])! + 1);
            }
        }
    }
    const order: string[] = [];
    const pending = [...ids];
    while (pending.length) {
        const i = pending.findIndex((id) => degrees.get(id) === 0);
        if (i < 0) return null;
        const [id] = pending.splice(i, 1);
        order.push(id);
        for (const to of edges.get(id)!) degrees.set(to, degrees.get(to)! - 1);
    }
    const projected = chainsFromOrder(config, order);
    return inputKinds.every((kind) => JSON.stringify(projected[kind]) === JSON.stringify(config.chains[kind]))
        ? order : null;
}

export function validChains(config: PortableConfig): PortableConfig["chains"] {
    const select = (kind: InputKind) => [...new Set(config.chains[kind])].filter((id) => {
        const model = config.models.find((m) => m.id === id);
        return model && eligible(config, model, kind);
    });
    return { text: select("text"), vision: select("vision") };
}

export function moveInOrder(order: string[], index: number, delta: number): string[] {
    const result = [...order];
    const target = index + delta;
    if (index < 0 || index >= result.length || target < 0 || target >= result.length) return result;
    [result[index], result[target]] = [result[target], result[index]];
    return result;
}
