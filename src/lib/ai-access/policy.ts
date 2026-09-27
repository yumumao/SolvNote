import { createHash } from "node:crypto";
import type { AIModel, PortableConfig } from "../ai-config/schema";
import type { SiteModelSummary } from "./types";
export function listConfiguredSiteModels(config: PortableConfig): SiteModelSummary[] {
    return config.models.flatMap(model => {
        const provider = config.providers.find(p => p.id === model.providerId);
        return model.enabled && provider?.enabled ? [{id:model.id,name:model.name,model:model.model,providerName:provider.name,capabilities:[...model.capabilities]}] : [];
    });
}
export function assertDefaultModelSelection(ids: string[], usableIds: Set<string>): void {
    if (ids.length !== Math.min(3, usableIds.size) || new Set(ids).size !== ids.length) throw Error("DEFAULT_MODEL_LIMIT");
    if (ids.some(id => !usableIds.has(id))) throw Error("MODEL_NOT_AVAILABLE");
}
export function buildNewUserSiteGrants(ids: string[]) {
    return ids.map((modelId,index) => ({modelId,source:"default" as const,rank:index+1}));
}
/** Credential rotations and labels are not identity changes; changing recipient is. */
export function siteModelFingerprint(config: PortableConfig, model: AIModel): string {
    const p = config.providers.find(p => p.id === model.providerId);
    if (!p || model.id.startsWith("private/")) throw Error("MODEL_ID_RESERVED");
    return createHash("sha256").update(JSON.stringify([p.id,p.protocol,new URL(p.baseUrl).href.replace(/\/+$/,""),p.apiVersion||"",model.model])).digest("hex");
}
