import { createHash } from "node:crypto";
import type { PortableConfig } from "../ai-config/schema";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
/** Never trust user-supplied IDs as global identifiers. Entire source ID participates in hash. */
export function privateRuntimeConfig(userId: string, source: PortableConfig): PortableConfig {
    const prefix = `private/${hash(userId).slice(0,32)}/`;
    const providerId = (id:string) => `${prefix}p/${hash(id).slice(0,32)}`;
    const modelId = (id:string) => `${prefix}m/${hash(id)}`;
    return {version:1,providers:source.providers.map(p=>({...p,id:providerId(p.id)})),models:source.models.map(m=>({...m,id:modelId(m.id),providerId:providerId(m.providerId)})),chains:{text:source.chains.text.map(modelId),vision:source.chains.vision.map(modelId)}};
}
export function mergeEffectiveConfig(site: PortableConfig, allowed: Set<string>, privateConfig: PortableConfig): PortableConfig {
    const models = site.models.filter(m=>allowed.has(m.id) && m.enabled && site.providers.some(p=>p.id===m.providerId && p.enabled));
    const siteIds = new Set(models.map(m=>m.id));
    const providers = site.providers.filter(p=>models.some(m=>m.providerId===p.id));
    const privateModels = privateConfig.models.filter(m=>m.enabled && privateConfig.providers.some(p=>p.id===m.providerId && p.enabled));
    const allModels = [...models,...privateModels];
    const chain = (kind:"text"|"vision") => [...new Set([...site.chains[kind].filter(id=>siteIds.has(id)),...models.filter(m=>m.capabilities.includes(kind)).map(m=>m.id),...privateConfig.chains[kind],...privateModels.filter(m=>m.capabilities.includes(kind)).map(m=>m.id)])].filter(id=>allModels.some(m=>m.id===id && m.capabilities.includes(kind)));
    return {version:1,providers:[...providers,...privateConfig.providers.filter(p=>privateModels.some(m=>m.providerId===p.id))],models:allModels,chains:{text:chain("text"),vision:chain("vision")}};
}
