import { aiJson, requireUser } from "@/lib/ai-access";
import { loadEffectiveAIConfig } from "@/lib/ai-access/effective-config";
import { listConfiguredSiteModels } from "@/lib/ai-access/policy";
import { accessError } from "@/lib/ai-access/errors";
export const dynamic="force-dynamic";
export async function GET(req:Request){try{
 const user=await requireUser(req), effective=await loadEffectiveAIConfig(user.id);
 return aiJson({revisions:effective.revisions,models:listConfiguredSiteModels(effective.config).map(m=>({...m,source:effective.privateModelIds.includes(m.id)?"private":"site"})),chains:effective.config.chains});
}catch(e){return accessError(e);}}
