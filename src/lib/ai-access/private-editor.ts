import { z } from "zod";
import { ConfigSchema, ProviderSchema, ModelSchema, type PortableConfig } from "../ai-config/schema";
export const PrivateConfigSchema = z.object({version:z.literal(1),providers:z.array(ProviderSchema.strict()).max(10),models:z.array(ModelSchema.strict()).max(30),chains:z.object({text:z.array(z.string().max(160)).max(30),vision:z.array(z.string().max(160)).max(30)}).strict()}).strict().transform(c=>ConfigSchema.parse(c));
const recipient = (p:PortableConfig["providers"][number]) => JSON.stringify([p.id,p.protocol,new URL(p.baseUrl).href.replace(/\/+$/,""),p.apiVersion||""]);
export function parsePrivateEdit(raw:unknown, current:PortableConfig):PortableConfig {
    const parsed=PrivateConfigSchema.parse(raw);
    for(const p of parsed.providers){
        if(p.apiKey!=="********")continue;
        const prior=current.providers.find(old=>old.id===p.id);
        if(!prior?.apiKey || recipient(prior)!==recipient(p))throw Error("PRIVATE_KEY_REQUIRED");
        p.apiKey=prior.apiKey;
    }
    return parsed;
}
/** Explicit whitelist: absence of apiKey is intentional, hasKey is not a mask. */
export function privateConfigDTO(config:PortableConfig){
    return {version:1 as const,providers:config.providers.map(p=>({id:p.id,name:p.name,protocol:p.protocol,baseUrl:p.baseUrl,enabled:p.enabled,hasKey:!!p.apiKey,...(p.apiVersion?{apiVersion:p.apiVersion}:{})})),models:config.models.map(m=>({id:m.id,providerId:m.providerId,name:m.name,model:m.model,capabilities:m.capabilities,enabled:m.enabled})),chains:{text:[...config.chains.text],vision:[...config.chains.vision]}};
}
