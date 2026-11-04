import { z } from "zod";

export type ModelOrder = { text: string[]; vision: string[] };
const ids = z.array(z.string().min(1).max(160)).max(230).refine(v => new Set(v).size === v.length);
export const ModelOrderSchema = z.object({text:ids, vision:ids}).strict();
export const emptyOrder = (): ModelOrder => ({text:[], vision:[]});

export function readOrder(raw: string | null | undefined): ModelOrder {
    if (!raw) return emptyOrder();
    try { return ModelOrderSchema.parse(JSON.parse(raw)); }
    catch { return emptyOrder(); }
}

/** Only reorders the already-authorized catalog. Stored IDs never grant access. */
export function applyOrder(available: ModelOrder, preferred: ModelOrder): ModelOrder {
    const order = (kind: keyof ModelOrder) => {
        const usable = new Set(available[kind]);
        return [...new Set([...preferred[kind], ...available[kind]])].filter(id => usable.has(id));
    };
    return {text:order("text"), vision:order("vision")};
}

export function validateOrder(input: ModelOrder, available: ModelOrder): void {
    for (const kind of ["text", "vision"] as const) {
        if (input[kind].length !== available[kind].length || new Set(input[kind]).size !== input[kind].length || input[kind].some(id => !available[kind].includes(id))) {
            throw Error("MODEL_NOT_AVAILABLE");
        }
    }
}

/** Administrator owns built-in relative order; personal slots stay with their owner. */
export function replaceSiteOrder(current: ModelOrder, site: ModelOrder): ModelOrder {
    const order = (kind: keyof ModelOrder) => {
        let index = 0;
        const result = current[kind].flatMap(id => id.startsWith("private/") ? [id] : index < site[kind].length ? [site[kind][index++]] : []);
        return [...result, ...site[kind].slice(index)];
    };
    return {text:order("text"), vision:order("vision")};
}
