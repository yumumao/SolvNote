// @vitest-environment node
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from "vitest";
import {mkdtempSync,mkdirSync,existsSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const shared=vi.hoisted(()=>({db:null as unknown as PrismaClient,user:"alice" as string|null}));
vi.mock("@/lib/prisma",()=>({get prisma(){return shared.db;}}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("next-auth",()=>({getServerSession:async()=>shared.user?{user:{id:shared.user,sessionVersion:0}}:null}));
vi.mock("@/lib/config",()=>({getAppConfig:()=>({})}));
import {saveAIConfig} from "@/lib/ai-config/store";
import {submitJob,readJob} from "@/lib/ai-jobs/store";
import {claimJob} from "@/lib/ai-jobs/worker";
import {protect,masterKey} from "@/lib/ai-config/vault";
import {GET as jobsGET} from "@/app/api/ai/jobs/route";
let oldDir:string|undefined;
const old=new Date('2020-01-01T00:00:00Z');
const req=(url:string)=>new Request('http://localhost'+url);
beforeAll(async()=>{
 mkdirSync('.codex/tmp',{recursive:true});const dir=mkdtempSync(path.resolve('.codex/tmp/records-db-'));
 oldDir=process.env.AI_CONFIG_DIR;process.env.AI_CONFIG_DIR=path.join(dir,'config');
 const url='file:'+path.join(dir,'fixture.db').replaceAll('\\','/');
 execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:url},stdio:'pipe',windowsHide:true});
 shared.db=new PrismaClient({datasources:{db:{url}}});masterKey(true);
 await saveAIConfig({version:1,providers:[{id:"p",name:"Fixture",protocol:"chat",baseUrl:"https://example.invalid/v1",apiKey:"synthetic",enabled:true}],models:[{id:"m",providerId:"p",name:"Fixture",model:"fixture",capabilities:["text"],enabled:true}],chains:{text:["m"],vision:[]}},0);
 for(const id of ['alice','bob'])await shared.db.user.create({data:{id,email:id+'@example.invalid',password:'unused',isActive:true}});
},30000);
beforeEach(async()=>{shared.user='alice';await shared.db.aiConversation.deleteMany();await shared.db.aiJob.deleteMany();await shared.db.aiWorkerLease.deleteMany();});
afterAll(async()=>{await shared.db?.$disconnect();if(oldDir===undefined)delete process.env.AI_CONFIG_DIR;else process.env.AI_CONFIG_DIR=oldDir;});
async function job(id:string,kind='analyze',userId='alice',state='success'){
 return shared.db.aiJob.create({data:{id,userId,kind,state,requestKey:id,input:protect({questionText:'Synthetic '+id}),result:protect({questionText:'Synthetic '+id,answerText:'4',analysis:'Fixture only'}),expiresAt:old,createdAt:old}});
}
async function conversation(id:string,state='answered',userId='alice'){
 return shared.db.aiConversation.create({data:{id,userId,state,roundsUsed:3,payload:protect({input:{questionText:'Synthetic '+id},messages:[],questions:[],rereads:0}),createdAt:old}});
}
describe.sequential('long-lived solving records, synthetic SQLite only',()=>{
 it('retains new direct and reanswer tasks beyond 24 hours but not drawings',async()=>{
  const a=await submitJob('alice','analyze',{questionText:'Synthetic'},'new-a');
  const b=await submitJob('alice','reanswer',{questionText:'Synthetic'},'new-b');
  const c=await submitJob('alice','construction',{questionText:'Synthetic'},'new-c');
  expect(a.expiresAt.getTime()-Date.now()).toBeGreaterThan(365*86400000);
  expect(b.expiresAt.getTime()-Date.now()).toBeGreaterThan(365*86400000);
  expect(c.expiresAt.getTime()-Date.now()).toBeLessThan(25*3600000);
 });
 it('keeps surviving old solves readable without exposing another account',async()=>{
  await job('old');expect(await readJob('alice','old',true)).not.toBeNull();
  expect(await readJob('bob','old',true)).toBeNull();
  const res=await jobsGET(req('/api/ai/jobs'));expect((await res.json()).jobs.map((j:{id:string})=>j.id)).toContain('old');
 });
 it('worker only purges temporary tasks, never retained solves or restarts expired pending work',async()=>{
  await job('a');await job('b','reanswer');await job('c','construction');await job('pending','analyze','alice','pending');
  expect(await claimJob('fixture-worker')).toBeNull();
  expect((await shared.db.aiJob.findMany()).map(j=>j.id).sort()).toEqual(['a','b','pending']);
  expect(await shared.db.aiJob.findUnique({where:{id:'pending'}})).toMatchObject({state:'failed',errorCode:'AI_TASK_EXPIRED'});
 });
 it('lists bounded summaries with stable pagination and no duplicate dialogue jobs',async()=>{
  expect(existsSync('src/app/api/solving-records/route.ts')).toBe(true);
  const {GET}=await import('@/app/api/solving-records/route');
  await conversation('c');await conversation('private-c','answered','bob');
  for(let i=0;i<24;i++)await job('j'+String(i).padStart(2,'0'));
  await job('private','analyze','bob');await job('draw','construction');await job('practice','practice');
  await shared.db.aiJob.create({data:{id:'internal',userId:'alice',kind:'dialogue',conversationId:'c',requestKey:'internal',input:protect({}),expiresAt:new Date('9999-01-01')}});
  const response=await GET(req('/api/solving-records'));expect(response.headers.get('cache-control')).toContain('no-store');
  const first=await response.json();expect(first.records).toHaveLength(20);expect(first.nextCursor).toBeTruthy();
  const second=await (await GET(req('/api/solving-records?cursor='+encodeURIComponent(first.nextCursor)))).json();
  expect(second.records).toHaveLength(5);expect(second.nextCursor).toBeNull();
  const all=[...first.records,...second.records];expect(new Set(all.map(r=>r.key)).size).toBe(25);
  expect(JSON.stringify(all)).not.toMatch(/private|ciphertext|imageBase64|payload|input/);
  expect(all[0].title).toMatch(/Synthetic/);
  expect((await GET(req('/api/solving-records?cursor=garbage'))).status).toBe(400);
  shared.user=null;expect((await GET(req('/api/solving-records'))).status).toBe(401);
 });
 it('counts all records, not a limited page or AI rounds, and isolates users',async()=>{
  expect(existsSync('src/app/api/stats/solving/route.ts')).toBe(true);
  const {GET}=await import('@/app/api/stats/solving/route');
  await conversation('c');await conversation('waiting','awaiting_user');await conversation('private','answered','bob');
  for(let i=0;i<105;i++)await job('a'+i);
  await job('failed','reanswer','alice','failed');await job('draw','construction');await job('practice','practice');
  await shared.db.aiAttempt.create({data:{jobId:'a0',modelId:'fixture',state:'success'}});
  const stats=await (await GET(req('/api/stats/solving'))).json();
  expect(stats.total).toBe(108);expect(stats.completed).toBe(106);expect(stats.awaiting).toBe(1);expect(stats.failed).toBe(1);
  expect(stats.aiCalls).toBe(1);expect(stats.months).toHaveLength(6);
  shared.user='bob';expect((await (await GET(req('/api/stats/solving'))).json()).total).toBe(1);
 });
 it('filters states, tolerates unreadable ciphertext and rejects disabled accounts',async()=>{
  const {GET}=await import('@/app/api/solving-records/route');
  const {GET:statsGET}=await import('@/app/api/stats/solving/route');
  await conversation('waiting','awaiting_user');await job('good');await job('broken');
  await shared.db.aiJob.update({where:{id:'broken'},data:{input:'not-ciphertext'}});
  const filtered=await (await GET(req('/api/solving-records?status=awaiting'))).json();
  expect(filtered.records.map((r:{id:string})=>r.id)).toEqual(['waiting']);
  const completed=await (await GET(req('/api/solving-records?status=completed'))).json();
  expect(completed.records.find((r:{id:string;title:string})=>r.id==='broken').title).toContain('暂不可读');
  expect((await GET(req('/api/solving-records?status=__proto__'))).status).toBe(400);
  await shared.db.user.update({where:{id:'alice'},data:{isActive:false}});
  try {expect((await GET(req('/api/solving-records'))).status).toBe(403);expect((await statsGET(req('/api/stats/solving'))).status).toBe(403);}
  finally {await shared.db.user.update({where:{id:'alice'},data:{isActive:true}});}
 });
 it('groups monthly creation at UTC+8 boundaries and prefers corrected text',async()=>{
  const {solvingStats,listSolvingRecords}=await import('@/lib/solving-records/store');
  await conversation('c');await job('j');
  await shared.db.aiConversation.update({where:{id:'c'},data:{createdAt:new Date('2026-08-31T15:59:59Z'),payload:protect({input:{questionText:'Old'},userCorrectedTranscript:true,transcript:{text:'Human correction'},result:{questionText:'AI old'}})}});
  await shared.db.aiJob.update({where:{id:'j'},data:{createdAt:new Date('2026-08-31T16:00:00Z')}});
  const stats=await solvingStats('alice',new Date('2026-09-26T00:00:00Z'));
  expect(stats.months.slice(-2)).toEqual([{month:'2026-08',count:1},{month:'2026-09',count:1}]);
  expect((await listSolvingRecords('alice',new URLSearchParams())).records.find(r=>r.id==='c')?.title).toBe('Human correction');
 });
 it('does not force deletion of completed history to create a new conversation',async()=>{
  const {createConversation}=await import('@/lib/ai-dialogue/store');
  for(let i=0;i<101;i++)await conversation('archive'+i);
  const id=await createConversation('alice',{questionText:'Synthetic new question'},'history-allowed');
  expect(id).toBeTruthy();expect(await shared.db.aiConversation.count({where:{userId:'alice'}})).toBe(102);
 });
 it('still limits unfinished conversations without deleting archives',async()=>{
  const {createConversation}=await import('@/lib/ai-dialogue/store');
  for(let i=0;i<100;i++)await conversation('waiting'+i,'awaiting_user');
  await expect(createConversation('alice',{questionText:'Synthetic new question'},'unfinished-limit')).rejects.toThrow('DIALOGUE_STORAGE_LIMIT');
  expect(await shared.db.aiConversation.count()).toBe(100);
 });

 it('summarizes picture-only direct solves using their stored result without returning images',async()=>{
  const {listSolvingRecords}=await import('@/lib/solving-records/store');
  await job('image');
  await shared.db.aiJob.update({where:{id:'image'},data:{input:protect({questionText:'',imageBase64:'synthetic-only'}),result:protect({questionText:'Recognized synthetic question',answerText:'4'})}});
  const records=await listSolvingRecords('alice',new URLSearchParams());
  expect(records.records[0].title).toBe('Recognized synthetic question');
  expect(JSON.stringify(records)).not.toContain('synthetic-only');
 });

});
