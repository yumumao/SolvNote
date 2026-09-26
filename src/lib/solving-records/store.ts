import {prisma} from "../prisma";
import {unprotect} from "../ai-config/vault";
import {AIRequestError} from "../ai-access";
import type {DialoguePayload} from "../ai-dialogue/types";
import type {JobInput} from "../ai-jobs/schema";
import {SOLVING_JOB_KINDS} from "./retention";
import {recordStatus,stateGroups,type RecordStatus,type RecordPage,type SolvingRecord,type SolvingStats} from "./types";
const PAGE_SIZE=20;
type Cursor={at:string;key:string};
function cursorFrom(raw:string|null):Cursor|null {
    if(!raw)return null;
    try {
        if(raw.length>512)throw Error();
        const v=JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));
        if(typeof v.at!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.at) || !Number.isFinite(Date.parse(v.at)) || typeof v.key!=="string" || !/^[cj]:[a-zA-Z0-9_-]{1,120}$/.test(v.key))throw Error();
        return {at:v.at,key:v.key};
    }catch{throw new AIRequestError(400,"INVALID_CURSOR");}
}
function before(cursor:Cursor|null,prefix:string): {OR?: {createdAt: Date | {lt:Date}; id?: {lt:string}}[]} {
    if(!cursor)return {};
    const time=new Date(cursor.at);
    const same=prefix===cursor.key[0]?{createdAt:time,id:{lt:cursor.key.slice(2)}}:prefix<cursor.key[0]?{createdAt:time}:null;
    return {OR:[{createdAt:{lt:time}},...(same?[same]:[])]};
}
function titleOf(encrypted:string,conversation:boolean,result?:string|null):string {
    try {
        const p=unprotect<DialoguePayload & JobInput>(encrypted);
        const text=conversation?(p.userCorrectedTranscript?p.transcript?.text:undefined)||p.result?.questionText||p.input?.questionText||p.transcript?.text:p.questionText?.trim() || (result?unprotect<{questionText?:string}>(result).questionText:undefined);
        return (typeof text==="string"?text.replace(/\s+/g," ").trim().slice(0,160):"") || "图片题目（打开查看）";
    }catch{return "记录内容暂不可读，请检查备份和主钥";}
}
export async function listSolvingRecords(userId:string,params:URLSearchParams):Promise<RecordPage> {
    const cursor=cursorFrom(params.get("cursor"));const status=params.get("status")||"all";
    if(status!=="all" && !Object.hasOwn(stateGroups,status))throw new AIRequestError(400,"INVALID_FILTER");
    const state=status==="all"?{}:{state:{in:stateGroups[status as RecordStatus]}};
    const [conversations,jobs]=await prisma.$transaction([
        prisma.aiConversation.findMany({where:{userId,...before(cursor,"c"),...state},orderBy:[{createdAt:"desc"},{id:"desc"}],take:PAGE_SIZE+1,select:{id:true,state:true,createdAt:true,updatedAt:true,roundsUsed:true,payload:true}}),
        prisma.aiJob.findMany({where:{userId,conversationId:null,kind:{in:SOLVING_JOB_KINDS},...before(cursor,"j"),...state},orderBy:[{createdAt:"desc"},{id:"desc"}],take:PAGE_SIZE+1,select:{id:true,kind:true,state:true,createdAt:true,updatedAt:true,input:true,result:true}}),
    ]);
    // Decrypt only the bounded page, never an account's entire record archive.
    const candidates=[...conversations.map(c=>({...c,key:"c:"+c.id,kind:"conversation" as const,encrypted:c.payload})),...jobs.map(j=>({...j,key:"j:"+j.id,kind:j.kind as "analyze"|"reanswer",encrypted:j.input}))];
    candidates.sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime() || (a.key<b.key?1:a.key>b.key?-1:0));
    const page=candidates.slice(0,PAGE_SIZE);
    const records:SolvingRecord[]=page.map(r=>({key:r.key,id:r.id,kind:r.kind,title:titleOf(r.encrypted,r.kind==="conversation","result" in r?r.result:undefined),state:r.state,status:recordStatus(r.state),createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString(),...("roundsUsed" in r?{roundsUsed:r.roundsUsed}:{})}));
    const last=records.at(-1);
    return {records,nextCursor:candidates.length>PAGE_SIZE && last?Buffer.from(JSON.stringify({at:last.createdAt,key:last.key})).toString("base64url"):null};
}
export async function solvingStats(userId:string,now=new Date()):Promise<SolvingStats> {
    const jobWhere={userId,conversationId:null,kind:{in:SOLVING_JOB_KINDS}};
    const [conversations,jobs,aiCalls]=await Promise.all([
        prisma.aiConversation.groupBy({by:["state"],orderBy:{state:"asc"},where:{userId},_count:{_all:true}}),
        prisma.aiJob.groupBy({by:["state"],orderBy:{state:"asc"},where:jobWhere,_count:{_all:true}}),
        prisma.aiAttempt.count({where:{job:{userId,OR:[{conversationId:{not:null}},{conversationId:null,kind:{in:SOLVING_JOB_KINDS}}]}}}),
    ]);
    const stats:SolvingStats={total:0,completed:0,awaiting:0,processing:0,failed:0,cancelled:0,aiCalls,months:[]};
    for(const row of [...conversations,...jobs]){stats.total+=row._count._all;stats[recordStatus(row.state)]+=row._count._all;}
    // UTC+8 calendar months, explicit and independent of server timezone.
    const local=new Date(now.getTime()+8*3600000);
    for(let i=5;i>=0;i--){
        const start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-i,1)-8*3600000;
        const end=Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-i+1,1)-8*3600000;
        const createdAt={gte:new Date(start),lt:new Date(end)};
        const [a,b]=await prisma.$transaction([prisma.aiConversation.count({where:{userId,createdAt}}),prisma.aiJob.count({where:{...jobWhere,createdAt}})]);
        stats.months.push({month:new Date(start+8*3600000).toISOString().slice(0,7),count:a+b});
    }
    return stats;
}
