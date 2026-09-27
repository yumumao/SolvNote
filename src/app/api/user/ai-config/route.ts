import { z } from "zod";
import { aiJson, requireUser } from "@/lib/ai-access";
import { readPrivateConfig, savePrivateConfig } from "@/lib/ai-access/private-store";
import { privateConfigDTO } from "@/lib/ai-access/private-editor";
import { loadEffectiveAIConfig } from "@/lib/ai-access/effective-config";
import { listConfiguredSiteModels } from "@/lib/ai-access/policy";
import { accessError } from "@/lib/ai-access/errors";
import { readAccessMutation } from "@/lib/ai-access/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const edit=z.object({revision:z.number().int().nonnegative(),config:z.unknown()}).strict();
export async function GET(req:Request){try{
    const user=await requireUser(req), current=await readPrivateConfig(user.id), effective=await loadEffectiveAIConfig(user.id);
    const siteIds=new Set(effective.siteModelIds);
    return aiJson({revision:current.revision,config:privateConfigDTO(current.config),siteModels:listConfiguredSiteModels(effective.config).filter(m=>siteIds.has(m.id))});
}catch(e){return accessError(e);}}
export async function PUT(req:Request){try{
    const user=await requireUser(req), body=edit.parse(await readAccessMutation(req,user.id,"private"));
    return aiJson(await savePrivateConfig(user.id,body.config,body.revision,user.sessionVersion));
}catch(e){return accessError(e);}}
