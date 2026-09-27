import {createHash} from "node:crypto";
import {z} from "zod";
import {prisma} from "../prisma";
import {protect,unprotect} from "../ai-config/vault";
import {loadAIConfig} from "../ai-config/store";
import {loadEffectiveAIConfig} from "../ai-access/effective-config";
import type {PortableConfig} from "../ai-config/schema";
import {AIRequestError} from "../ai-access";
const ID="notebook-drawing";
type Saved={modelId:string|null;fingerprint?:string};
function fail(code:string,status=400):never{throw new AIRequestError(status,code);}
function modelChoice(config:PortableConfig,id:string){
    const m=config.models.find(m=>m.id===id),p=config.providers.find(p=>p.id===m?.providerId);
    if(!m?.enabled||!p?.enabled||p.protocol!=="gemini"||!m.capabilities.includes("vision"))return null;
    // Bind the permission to the exact recipient, not a reusable imported ID.
    const fingerprint=createHash("sha256").update(JSON.stringify([m.id,m.model,p.id,p.protocol,p.baseUrl,p.apiKey])).digest("hex");
    return {model:m,provider:p,fingerprint};
}
export async function drawingSettings(admin=false,userId?:string){
    const {config,revision:configRevision}=userId?await loadEffectiveAIConfig(userId):await loadAIConfig({persist:false});
    const row=await prisma.aiConfiguration.findUnique({where:{id:ID}});
    const stored=row?unprotect<Saved>(row.payload):{modelId:null};
    const choice=stored.modelId?modelChoice(config,stored.modelId):null;
    const valid=!!choice && stored.fingerprint===choice.fingerprint;
    return {enabled:valid,revision:row?.revision||0,modelName:valid?choice!.model.name:null,providerName:valid?choice!.provider.name:null,
        ...(admin?{modelId:stored.modelId,configRevision,models:config.models.flatMap(m=>{const c=modelChoice(config,m.id);return c?[{id:m.id,name:m.name,model:m.model,providerName:c.provider.name}]:[]})}:{})};
}
export async function saveDrawingSettings(userId:string,raw:unknown){
    const data=z.object({modelId:z.string().min(1).max(160).nullable(),revision:z.number().int().min(0),configRevision:z.number().int().min(0).optional()}).strict().parse(raw);
    const {config,revision:configRevision}=await loadAIConfig({persist:false});
    const choice=data.modelId?modelChoice(config,data.modelId):null;
    if(data.modelId&&!choice)fail("AI_IMAGE_EDIT_UNSUPPORTED");
    if(data.modelId && data.configRevision!==configRevision)fail("CONFIG_CONFLICT",409);
    const saved:Saved={modelId:data.modelId,...(choice?{fingerprint:choice.fingerprint}:{})};
    await prisma.$transaction(async tx=>{
        const u=await tx.user.findUnique({where:{id:userId}});if(!u?.isActive||u.role!=="admin")fail("FORBIDDEN",403);
        const current=await tx.aiConfiguration.findUnique({where:{id:"site"}});if(data.modelId && current?.revision!==configRevision)fail("CONFIG_CONFLICT",409);
        const old=await tx.aiConfiguration.findUnique({where:{id:ID}});if((old?.revision||0)!==data.revision)fail("CONFIG_CONFLICT",409);
        if(old){const r=await tx.aiConfiguration.updateMany({where:{id:ID,revision:data.revision},data:{payload:protect(saved),revision:{increment:1}}});if(!r.count)fail("CONFIG_CONFLICT",409);}
        else await tx.aiConfiguration.create({data:{id:ID,revision:1,payload:protect(saved)}});
    });
    return drawingSettings(true);
}
export async function approvedImageEditor(config:PortableConfig,revision:number|undefined){
    const row=await prisma.aiConfiguration.findUnique({where:{id:ID}});
    if(!row || row.revision!==revision)fail("AI_IMAGE_EDIT_SETTINGS_CHANGED",409);
    const stored=unprotect<Saved>(row.payload),choice=stored.modelId?modelChoice(config,stored.modelId):null;
    if(!choice || stored.fingerprint!==choice.fingerprint)fail("AI_IMAGE_EDIT_NOT_CONFIGURED",409);
    return choice;
}
