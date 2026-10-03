import {createHash} from "node:crypto";
import {z} from "zod";
import {prisma} from "../prisma";
import {protect,unprotect} from "../ai-config/vault";
import {parseConfig,type PortableConfig} from "../ai-config/schema";
import {AIRequestError} from "../ai-access";
import {requireTxAiUser} from "../ai-access/account";
import type {AiAccessTx} from "../ai-access/types";
import {IllustrationModel,miniMaxEndpoint} from "./illustration-schema";
const ID="notebook-illustration";
const Saved=z.object({providerId:z.string().nullable(),model:IllustrationModel,fingerprint:z.string().optional()});
type Saved=z.infer<typeof Saved>;
const Input=Saved.omit({fingerprint:true}).extend({revision:z.number().int().min(0),configRevision:z.number().int().min(0)}).strict();
function choice(config:PortableConfig,saved:Saved){
    const provider=config.providers.find(p=>p.id===saved.providerId);
    if(!provider?.enabled||!provider.apiKey||!miniMaxEndpoint(provider.baseUrl))return null;
    const fingerprint=createHash("sha256").update(JSON.stringify([provider.id,provider.baseUrl,provider.protocol,provider.apiKey,saved.model])).digest("hex");
    return {provider,model:saved.model,fingerprint};
}
async function state(tx:AiAccessTx,userId:string){
    await requireTxAiUser(tx,userId,true);
    const site=await tx.aiConfiguration.findUnique({where:{id:"site"}});
    const config=site?parseConfig(unprotect(site.payload)):parseConfig({version:1,providers:[],models:[],chains:{text:[],vision:[]}});
    const row=await tx.aiConfiguration.findUnique({where:{id:ID}});
    const saved=row?Saved.parse(unprotect(row.payload)):{providerId:null,model:"image-01" as const};
    const selected=choice(config,saved),enabled=!!selected&&saved.fingerprint===selected.fingerprint;
    return {config,configRevision:site?.revision||0,row,saved,selected,enabled};
}
export async function getIllustrationSettings(userId:string){
    return prisma.$transaction(async tx=>{
        const s=await state(tx,userId);
        return {revision:s.row?.revision||0,configRevision:s.configRevision,providerId:s.saved.providerId,model:s.saved.model,enabled:s.enabled,
            providerName:s.enabled?s.selected!.provider.name:null,
            providers:s.config.providers.filter(p=>p.enabled&&!!p.apiKey&&miniMaxEndpoint(p.baseUrl)).map(p=>({id:p.id,name:p.name,baseUrl:p.baseUrl}))};
    });
}
export async function saveIllustrationSettings(userId:string,raw:unknown){
    const input=Input.parse(raw);
    await prisma.$transaction(async tx=>{
        const s=await state(tx,userId);
        if((s.row?.revision||0)!==input.revision||s.configRevision!==input.configRevision)throw new AIRequestError(409,"CONFIG_CONFLICT");
        const selected=choice(s.config,input);
        if(input.providerId&&!selected)throw new AIRequestError(400,"AI_ILLUSTRATION_ENDPOINT");
        const payload=protect({providerId:input.providerId,model:input.model,...(selected?{fingerprint:selected.fingerprint}:{})});
        if(s.row){const changed=await tx.aiConfiguration.updateMany({where:{id:ID,revision:input.revision},data:{payload,revision:{increment:1}}});if(changed.count!==1)throw new AIRequestError(409,"CONFIG_CONFLICT");}
        else await tx.aiConfiguration.create({data:{id:ID,revision:1,payload}});
    });
    return getIllustrationSettings(userId);
}
export async function requireIllustrationAccess(userId:string,revision:number|undefined,tx?:AiAccessTx){
    const check=async(db:AiAccessTx)=>{
        const s=await state(db,userId);
        if(!s.enabled||!s.row||s.row.revision!==revision)throw new AIRequestError(409,"AI_ILLUSTRATION_SETTINGS_CHANGED");
        return s.selected!;
    };
    return tx?check(tx):prisma.$transaction(check);
}
