// @vitest-environment node
/** Disposable database + synthetic key only. Never accesses real config or upstream services. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
const s=vi.hoisted(()=>({db:null as unknown as PrismaClient,actor:"admin",send:vi.fn(),network:vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");})}));
vi.mock("@/lib/prisma",()=>({get prisma(){return s.db;}}));
vi.mock("@/lib/config",()=>({getAppConfig:()=>{throw Error("REAL_CONFIG_FORBIDDEN");}}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("@/lib/user-management/live-session",()=>({getLiveUser:async(id:string)=>{
 const u=await s.db.user.findUnique({where:{id}});return u?.isActive && (!u.expiresAt || u.expiresAt>new Date())?u:null;
}}));
vi.mock("@/lib/ai-access",async original=>({...await original<typeof import("@/lib/ai-access")>(),requireUser:async()=>{
 const u=await s.db.user.findUnique({where:{id:s.actor}});if(!u?.isActive)throw Object.assign(Error("FORBIDDEN"),{status:403});return {id:u.id,role:u.role,sessionVersion:u.sessionVersion};
},requireAdmin:async()=>{
 const u=await s.db.user.findUnique({where:{id:s.actor}});if(!u?.isActive || u.role!=="admin")throw Object.assign(Error("FORBIDDEN"),{status:403});return {id:u.id,role:u.role,sessionVersion:u.sessionVersion};
}}));
vi.mock("@/lib/ai/transport",async original=>({...await original<typeof import("@/lib/ai/transport")>(),sendAI:s.send}));
import { aiRun } from "@/lib/ai-jobs/context";
import { callChain } from "@/lib/ai/chain";
import { submitJob,readJob } from "@/lib/ai-jobs/store";
import { processOne } from "@/lib/ai-jobs/worker";
import { createConversation,actConversation,readConversation } from "@/lib/ai-dialogue/store";
import { listSolvingRecords } from "@/lib/solving-records/store";
import { saveAIConfig } from "@/lib/ai-config/store";
import { sealExport } from "@/lib/ai-config/crypto";
import { POST as SITE_POST } from "@/app/api/ai/config/route";
import { POST as SITE_IMPORT } from "@/app/api/ai/config/import/route";
import { POST as SITE_DEDUP } from "@/app/api/ai/config/deduplicate/route";
import { protect } from "@/lib/ai-config/vault";
import { loadEffectiveAIConfig, assertModelAllowedForUser } from "@/lib/ai-access/effective-config";
import { savePrivateConfig } from "@/lib/ai-access/private-store";
import { createInitialAiGrants } from "@/lib/ai-access/registration";
import { GET as POLICY_GET, PATCH as POLICY_PATCH } from "@/app/api/admin/ai/access/route";
import { GET as GRANTS_GET, PATCH as GRANTS_PATCH } from "@/app/api/admin/ai/access/users/[id]/route";
import { GET as PRIVATE_GET, PUT as PRIVATE_PUT } from "@/app/api/user/ai-config/route";
import { POST as PRIVATE_IMPORT } from "@/app/api/user/ai-config/import/route";
import type { PortableConfig } from "@/lib/ai-config/schema";
const site=():PortableConfig=>({version:1,providers:[{id:"p",name:"Site provider",protocol:"chat",baseUrl:"https://example.com/v1",apiKey:"synthetic-site-only",enabled:true}],models:[1,2,3,4].map(n=>({id:`m${n}`,providerId:"p",name:`M${n}`,model:`m${n}`,enabled:true,capabilities:["text"]})),chains:{text:["m1","m2","m3","m4"],vision:[]}});
const req=(method:string,body?:unknown,origin="https://example.com")=>new Request("https://example.com/api/ai",{method,headers:{origin,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function policy(){return (await POLICY_GET(req("GET"))).json();}
async function setPolicy(defaultModelIds=["m1","m2","m3"],allowedModelIds=["m1","m2","m3","m4"]){const current=await policy();return POLICY_PATCH(req("PATCH",{revision:current.revision,defaultModelIds,allowedModelIds}));}
beforeAll(async()=>{
 mkdirSync(".codex/tmp",{recursive:true});const dir=mkdtempSync(path.resolve(".codex/tmp/ai-access-"));
 const url=`file:${path.join(dir,"test.db").replaceAll("\\","/")}`;
 vi.stubEnv("AI_CONFIG_MASTER_KEY",Buffer.alloc(32,9).toString("base64"));vi.stubEnv("AI_CONFIG_DIR",path.join(dir,"vault"));vi.stubEnv("NEXTAUTH_URL","https://example.com");vi.stubGlobal("fetch",s.network);
 execFileSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env:{...process.env,DATABASE_URL:url},stdio:"pipe"});
 s.db=new PrismaClient({datasources:{db:{url}}});
},30000);
beforeEach(async()=>{
 s.actor="admin";s.send.mockReset();s.send.mockResolvedValue("synthetic-answer");
 await s.db.aiJob.deleteMany();await s.db.aiConversation.deleteMany();await s.db.aiWorkerLease.deleteMany();await s.db.authRateLimit.deleteMany();
 await s.db.aiUserModelGrant.deleteMany();await s.db.userAiConfiguration.deleteMany();await s.db.aiSiteModelAccess.deleteMany();await s.db.aiAccessPolicy.deleteMany();await s.db.aiConfiguration.deleteMany();await s.db.user.deleteMany();
 for(const id of ["admin","alice","bob"])await s.db.user.create({data:{id,email:`${id}@example.invalid`,password:"not-a-password",role:id==="admin"?"admin":"user",aiAccessInitialized:id!=="bob"}});
 await s.db.aiConfiguration.create({data:{id:"site",payload:protect(site()),revision:1}});
});
afterAll(async()=>{await s.db?.$disconnect();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe.sequential("policy bootstrap",()=>{
 it("initializes metadata/defaults before the first registration without a prior policy read",async()=>{
  const {ensureInitialAiPolicy}=await import("@/lib/ai-access/bootstrap");
  await ensureInitialAiPolicy();await s.db.$transaction(tx=>createInitialAiGrants(tx,"alice"));
  expect((await s.db.aiUserModelGrant.findMany({where:{userId:"alice"},orderBy:{rank:"asc"}})).map(g=>g.modelId)).toEqual(["m1","m2","m3"]);
  await setPolicy(["m4","m2","m3"]);await ensureInitialAiPolicy();expect((await policy()).defaultModelIds).toEqual(["m4","m2","m3"]);
 });
 it("allows a private-only account when the site has no models",async()=>{
  const {ensureInitialAiPolicy}=await import("@/lib/ai-access/bootstrap");
  await s.db.aiConfiguration.update({where:{id:"site"},data:{payload:protect({version:1,providers:[],models:[],chains:{text:[],vision:[]}})}});
  await ensureInitialAiPolicy();await s.db.$transaction(tx=>createInitialAiGrants(tx,"alice"));
  expect(await s.db.aiUserModelGrant.count({where:{userId:"alice"}})).toBe(0);
  await savePrivateConfig("alice",site(),0,0);expect((await loadEffectiveAIConfig("alice")).privateModelIds).toHaveLength(4);
  await saveAIConfig(site(),1);await ensureInitialAiPolicy();
  expect((await loadEffectiveAIConfig("alice")).siteModelIds).toEqual([]); // The empty new-user snapshot is permanent, not legacy.
  await s.db.user.create({data:{id:"later",email:"later@example.invalid",password:"unused",aiAccessInitialized:true}});
  await s.db.$transaction(tx=>createInitialAiGrants(tx,"later"));expect((await loadEffectiveAIConfig("later")).siteModelIds).toHaveLength(3);
 });
});
describe.sequential("AI access API and effective runtime boundary",()=>{
 it("redacts policy DTO and CAS protects defaults",async()=>{
  const initial=await policy();expect(JSON.stringify(initial)).not.toMatch(/apiKey|synthetic-site-only|baseUrl/);
  expect((await setPolicy()).status).toBe(200);
  expect((await POLICY_PATCH(req("PATCH",{revision:initial.revision,defaultModelIds:["m2","m3","m4"],allowedModelIds:["m1","m2","m3","m4"]}))).status).toBe(409);
 });
 it("rejects cross-origin, underfilled, duplicate defaults and nonadmin self-grant",async()=>{
  const p=await policy();const body={revision:p.revision,defaultModelIds:["m1","m2","m3"],allowedModelIds:["m1","m2","m3","m4"]};
  expect((await POLICY_PATCH(req("PATCH",body,"https://elsewhere.example"))).status).toBe(403);
  expect((await setPolicy(["m1"])).status).toBe(400);
  expect((await setPolicy(["m1","m1","m2"])).status).toBe(400);
  s.actor="alice";expect((await GRANTS_PATCH(req("PATCH",{revision:p.revision,modelIds:["m4"]}),ctx("alice"))).status).toBe(403);
 });
 it("snapshots defaults transactionally; later policy changes do not rewrite users",async()=>{
  await setPolicy(["m3","m1","m2"]);await s.db.$transaction(tx=>createInitialAiGrants(tx,"alice"));
  await setPolicy(["m2","m3","m4"]);
  const grants=await s.db.aiUserModelGrant.findMany({where:{userId:"alice"},orderBy:{rank:"asc"}});expect(grants.map(g=>g.modelId)).toEqual(["m3","m1","m2"]);
  await expect(s.db.$transaction(async tx=>{await tx.user.create({data:{id:"rollback",email:"rollback@example.invalid",password:"unused",aiAccessInitialized:true}});await createInitialAiGrants(tx,"rollback");throw Error("rollback");})).rejects.toThrow("rollback");
  expect(await s.db.aiUserModelGrant.count({where:{userId:"rollback"}})).toBe(0);
 });
 it("legacy gets all current allowed models exactly once, new users never get compatibility",async()=>{
  await setPolicy();expect((await loadEffectiveAIConfig("alice")).siteModelIds).toEqual([]);
  expect((await loadEffectiveAIConfig("bob")).siteModelIds).toHaveLength(4);
  await s.db.aiUserModelGrant.deleteMany({where:{userId:"bob",modelId:"m4"}});
  expect((await loadEffectiveAIConfig("bob")).siteModelIds).not.toContain("m4");expect((await s.db.user.findUnique({where:{id:"bob"}}))?.aiAccessInitialized).toBe(true);
 });
 it("admin grant replacement revokes immediately and bumps target sessionVersion",async()=>{
  await setPolicy();const p=await policy();
  expect((await GRANTS_PATCH(req("PATCH",{revision:p.revision,modelIds:["m4"]}),ctx("alice"))).status).toBe(200);
  expect((await loadEffectiveAIConfig("alice")).siteModelIds).toEqual(["m4"]);
  const dto=await (await GRANTS_GET(req("GET"),ctx("alice"))).json();
  expect((await GRANTS_PATCH(req("PATCH",{revision:dto.revision,modelIds:[]}),ctx("alice"))).status).toBe(200);
  await expect(assertModelAllowedForUser("alice","m4")).rejects.toThrow();expect((await s.db.user.findUnique({where:{id:"alice"}}))!.sessionVersion).toBeGreaterThan(0);
 });
 it("site removal tombstones ID, bumps policy and denies model ID recipient reuse atomically",async()=>{
  await setPolicy();const c=site();c.models=c.models.filter(m=>m.id!=="m4");c.chains.text=c.chains.text.filter(id=>id!=="m4");await saveAIConfig(c,1);
  expect((await s.db.aiSiteModelAccess.findUnique({where:{modelId:"m4"}}))!.isAllowed).toBe(false);
  const altered=site();altered.models[3].model="different-recipient";
  await expect(saveAIConfig(altered,2)).rejects.toThrow("MODEL_ID_REUSED");expect((await s.db.aiConfiguration.findUnique({where:{id:"site"}}))!.revision).toBe(2);
 });
 it("private CRUD is encrypted, scoped, strictly redacted and CAS; revocation preserves private",async()=>{
  await setPolicy();s.actor="alice";const c=site();c.providers[0].apiKey="synthetic-private-only";
  const saved=await PRIVATE_PUT(req("PUT",{revision:0,config:c}));expect(saved.status).toBe(200);
  const dto=await saved.json();expect(dto.revision).toBe(1);expect(JSON.stringify(dto)).not.toMatch(/apiKey|synthetic-(site|private)-only/);
  expect((await s.db.userAiConfiguration.findUnique({where:{userId:"alice"}}))!.payload).not.toContain("synthetic-private-only");
  expect((await PRIVATE_PUT(req("PUT",{revision:0,config:c}))).status).toBe(409);
  const effective=await loadEffectiveAIConfig("alice");expect(effective.siteModelIds).toEqual([]);expect(effective.privateModelIds).toHaveLength(4);
  s.actor="bob";const other=await (await PRIVATE_GET(req("GET"))).json();expect(other.config.providers).toEqual([]);
  await expect(assertModelAllowedForUser("bob",effective.privateModelIds[0])).rejects.toThrow();
 });
 it("private import cannot write another user, borrow site masks, or export saved keys",async()=>{
  await setPolicy();s.actor="alice";const c=site();c.providers[0].apiKey="********";
  expect((await PRIVATE_IMPORT(req("POST",{revision:0,format:"portable",mode:"replace",config:c}))).status).toBe(400);
  c.providers[0].apiKey="synthetic-private-only";
  expect((await PRIVATE_IMPORT(req("POST",{revision:0,format:"portable",mode:"replace",config:c,userId:"bob"}))).status).toBe(400);
  expect((await PRIVATE_IMPORT(req("POST",{revision:0,format:"portable",mode:"replace",config:c}))).status).toBe(200);
  expect(await s.db.userAiConfiguration.findUnique({where:{userId:"bob"}})).toBeNull();
 });
 it("expired, disabled, reset-required and deleted accounts cannot resolve runtime config",async()=>{
  await setPolicy();for(const data of [{expiresAt:new Date(0)},{expiresAt:null,isActive:false},{isActive:true,mustChangePassword:true}]){
   await s.db.user.update({where:{id:"alice"},data});await expect(loadEffectiveAIConfig("alice")).rejects.toThrow();
  }
  await s.db.user.delete({where:{id:"alice"}});await expect(loadEffectiveAIConfig("alice")).rejects.toThrow();expect(s.network).not.toHaveBeenCalled();
 });
});

const run=(fn:()=>Promise<unknown>)=>aiRun.run({userId:"alice",config:site(),signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:3},fn);
async function grant(modelId="m1"){await setPolicy();await s.db.aiUserModelGrant.create({data:{userId:"alice",modelId,source:"admin"}});}
async function resultJob(){return s.db.aiJob.create({data:{id:"synthetic-job",userId:"alice",kind:"reanswer",requestKey:"synthetic-key",input:protect({questionText:""}),state:"success",result:protect({questionText:"sensitive-derived-title",answerText:"synthetic-answer"}),expiresAt:new Date(Date.now()+60000),attemptsLog:{create:{modelId:"m1",state:"success"}}}});}
describe.sequential("revocation at every runtime boundary",()=>{
 it("cannot bypass grants by supplying a full cached config or explicit model ID",async()=>{
  await setPolicy();await expect(run(()=>callChain("p","t",undefined,s=>s,{modelId:"m4"}))).rejects.toThrow();expect(s.send).not.toHaveBeenCalled();
 });
 it("rechecks after the provider responds and before any fallback/next dispatch",async()=>{
  await grant();s.send.mockImplementationOnce(async()=>{await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice"}});return "synthetic-answer";});
  await expect(run(()=>callChain("p","t",undefined,s=>s))).rejects.toThrow();expect(s.send).toHaveBeenCalledTimes(1);
 });
 it("does not enqueue an unavailable model capability",async()=>{
  await setPolicy();await expect(submitJob("alice","reanswer",{questionText:"synthetic question"},"blocked-job")).rejects.toThrow();expect(await s.db.aiJob.count()).toBe(0);
 });
 it("polling/results do not disclose a result or model metadata after revocation",async()=>{
  await grant();const job=await resultJob();expect((await readJob("alice",job.id))?.state).toBe("success");
  await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice"}});await expect(readJob("alice",job.id,true)).rejects.toThrow();
 });
 it("list previews do not bypass a revoked result through a derived title",async()=>{
  await grant();await resultJob();await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice"}});
  expect(JSON.stringify(await listSolvingRecords("alice",new URLSearchParams()))).not.toContain("sensitive-derived-title");
 });
 it("conversation reads and continuation reject revoked contributing models",async()=>{
  await grant();const id=await createConversation("alice",{questionText:"synthetic question"},"synthetic-dialogue");
  const c=await s.db.aiConversation.findUniqueOrThrow({where:{id}});
  await s.db.aiAttempt.create({data:{jobId:c.activeJobId!,modelId:"m1",state:"success"}});
  await s.db.aiConversation.update({where:{id},data:{state:"awaiting_user"}});
  await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice"}});
  await expect(readConversation("alice",id)).rejects.toThrow();
  await expect(actConversation("alice",id,{kind:"continue",revision:c.revision},"synthetic-next")).rejects.toThrow();expect(s.send).not.toHaveBeenCalled();
 });
 it("worker checks expired accounts even on the dialogue branch",async()=>{
  await grant();const id=await createConversation("alice",{questionText:"synthetic question"},"synthetic-expire");
  await s.db.user.update({where:{id:"alice"},data:{expiresAt:new Date(0)}});
  await processOne("synthetic-worker");expect(s.send).not.toHaveBeenCalled();
  const c=await s.db.aiConversation.findUniqueOrThrow({where:{id}});expect(c.state).not.toBe("answered");
 });
});

describe.sequential("private request and result safety",()=>{
 it("rejects oversized, non-JSON and unknown-field edits without writing",async()=>{
  s.actor="alice";
  expect((await PRIVATE_PUT(req("PUT",{revision:0,config:site(),userId:"bob"}))).status).toBe(400);
  const wrongType=new Request("https://example.com/api/user/ai-config",{method:"PUT",headers:{origin:"https://example.com","content-type":"text/plain"},body:"{}"});
  expect((await PRIVATE_PUT(wrongType)).status).toBe(415);
  const big=new Request("https://example.com/api/user/ai-config",{method:"PUT",headers:{origin:"https://example.com","content-type":"application/json"},body:JSON.stringify({padding:"x".repeat(512*1024)})});
  expect((await PRIVATE_PUT(big)).status).toBe(413);expect(await s.db.userAiConfiguration.count()).toBe(0);
 });
 it("stale imports never replace newer private configuration and responses contain no secrets",async()=>{
  s.actor="alice";await savePrivateConfig("alice",site(),0,0);
  const response=await PRIVATE_IMPORT(req("POST",{format:"portable",mode:"replace",revision:0,config:site()}));
  expect(response.status).toBe(409);expect(await response.text()).not.toContain("synthetic-site-only");
  expect((await s.db.userAiConfiguration.findUniqueOrThrow({where:{userId:"alice"}})).revision).toBe(1);
 });
 it("deleting a private model immediately denies old job results and never affects another owner",async()=>{
  await savePrivateConfig("alice",site(),0,0);const effective=await loadEffectiveAIConfig("alice");
  const j=await resultJob();await s.db.aiAttempt.updateMany({where:{jobId:j.id},data:{modelId:effective.privateModelIds[0]}});
  expect((await readJob("alice",j.id))?.state).toBe("success");
  await savePrivateConfig("alice",{version:1,providers:[],models:[],chains:{text:[],vision:[]}},1,0);
  await expect(readJob("alice",j.id)).rejects.toThrow("AI_MODEL_ACCESS_REVOKED");
  expect(await s.db.userAiConfiguration.count({where:{userId:"bob"}})).toBe(0);
 });
});

describe.sequential("prior conversation contributors",()=>{
 it("never dispatches on an allowed model using context from a now-revoked prior model",async()=>{
  await grant();const id=await createConversation("alice",{questionText:"synthetic"},"prior-context");
  const c=await s.db.aiConversation.findUniqueOrThrow({where:{id}});
  await s.db.aiAttempt.create({data:{jobId:c.activeJobId!,modelId:"m1",state:"success"}});
  await s.db.aiUserModelGrant.create({data:{userId:"alice",modelId:"m2",source:"admin"}});
  await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice",modelId:"m1"}});
  await expect(aiRun.run({userId:"alice",conversationId:id,config:site(),signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:3},()=>callChain("p","t",undefined,s=>s,{modelId:"m2"}))).rejects.toThrow("AI_ACCESS_REVOKED");
  expect(s.send).not.toHaveBeenCalled();
 });
});


describe.sequential("conversation revocation races",()=>{
 it("rechecks historical contributors in the durable dispatch transaction",async()=>{
  await grant();const id=await createConversation("alice",{questionText:"synthetic"},"dispatch-race");
  const c=await s.db.aiConversation.findUniqueOrThrow({where:{id}});
  await s.db.aiAttempt.create({data:{jobId:c.activeJobId!,modelId:"m1",state:"success"}});
  await s.db.aiUserModelGrant.create({data:{userId:"alice",modelId:"m2",source:"admin"}});
  const owner="synthetic-owner",until=new Date(Date.now()+60000);
  await s.db.aiWorkerLease.create({data:{id:"site",owner,until}});
  await s.db.aiJob.update({where:{id:c.activeJobId!},data:{state:"running",leaseOwner:owner,leaseUntil:until}});
  let revokeAtCooldown=true;
  s.db.$use(async(params,next)=>{
   if(revokeAtCooldown && params.model==="AiCooldown" && params.action==="findUnique"){
    revokeAtCooldown=false;await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice",modelId:"m1"}});
   }
   return next(params);
  });
  try{
   await expect(aiRun.run({userId:"alice",conversationId:id,jobId:c.activeJobId!,leaseOwner:owner,signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:3},()=>callChain("p","t",undefined,s=>s,{modelId:"m2"}))).rejects.toThrow("AI_ACCESS_REVOKED");
   expect(s.send).not.toHaveBeenCalled();
  }finally{revokeAtCooldown=false;}
 });
 it("discards a response if an earlier conversation contributor was revoked during the request",async()=>{
  await grant();const id=await createConversation("alice",{questionText:"synthetic"},"response-race");
  const c=await s.db.aiConversation.findUniqueOrThrow({where:{id}});
  await s.db.aiAttempt.create({data:{jobId:c.activeJobId!,modelId:"m1",state:"success"}});
  await s.db.aiUserModelGrant.create({data:{userId:"alice",modelId:"m2",source:"admin"}});
  s.send.mockImplementationOnce(async()=>{await s.db.aiUserModelGrant.deleteMany({where:{userId:"alice",modelId:"m1"}});return "synthetic-answer";});
  await expect(aiRun.run({userId:"alice",conversationId:id,signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:3},()=>callChain("p","t",undefined,s=>s,{modelId:"m2"}))).rejects.toThrow("AI_ACCESS_REVOKED");
  expect(s.send).toHaveBeenCalledTimes(1);
 });
});


/** A zero-buffer stream starts only after the route has authenticated and reads its body. */
function delayedBody(body:unknown){
 let started!:()=>void,release!:()=>void;
 const reading=new Promise<void>(resolve=>{started=resolve;});
 const ready=new Promise<void>(resolve=>{release=resolve;});
 const stream=new ReadableStream<Uint8Array>({async pull(controller){started();await ready;controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();}},{highWaterMark:0});
 const request=new Request("https://example.com/api/test",{method:"PATCH",headers:{origin:"https://example.com","content-type":"application/json"},body:stream,duplex:"half"} as RequestInit & {duplex:"half"});
 return {request,reading,release};
}
describe.sequential("pending-body authorization",()=>{
 for(const endpoint of ["policy","grants","private","import"] as const){
  it(`rejects ${endpoint} when the authenticated session is revoked while reading the body`,async()=>{
   const current=await policy();const isAdmin=endpoint==="policy"||endpoint==="grants";s.actor=isAdmin?"admin":"alice";
   const body=endpoint==="policy"?{revision:current.revision,defaultModelIds:["m1","m2","m3"],allowedModelIds:["m1","m2","m3"]}:endpoint==="grants"?{revision:current.revision,modelIds:["m1"]}:endpoint==="private"?{revision:0,config:site()}:{revision:0,config:site(),format:"portable",mode:"replace"};
   const delayed=delayedBody(body);
   const response=endpoint==="policy"?POLICY_PATCH(delayed.request):endpoint==="grants"?GRANTS_PATCH(delayed.request,{params:Promise.resolve({id:"alice"})}):endpoint==="private"?PRIVATE_PUT(delayed.request):PRIVATE_IMPORT(delayed.request);
   await delayed.reading;
   await s.db.user.update({where:{id:s.actor},data:{sessionVersion:{increment:1}}});delayed.release();
   expect((await response).status).toBe(403);
   expect((await s.db.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}})).revision).toBe(current.revision);
   expect(await s.db.aiUserModelGrant.count()).toBe(0);expect(await s.db.userAiConfiguration.count()).toBe(0);
  });
 }
 for(const endpoint of ["policy","grants"] as const){
  it(`rejects ${endpoint} if the administrator loses their role while reading the body`,async()=>{
   const current=await policy();const delayed=delayedBody(endpoint==="policy"?{revision:current.revision,defaultModelIds:["m1","m2","m3"],allowedModelIds:["m1","m2","m3"]}:{revision:current.revision,modelIds:["m1"]});
   const response=endpoint==="policy"?POLICY_PATCH(delayed.request):GRANTS_PATCH(delayed.request,{params:Promise.resolve({id:"alice"})});
   await delayed.reading;await s.db.user.update({where:{id:"admin"},data:{role:"user"}});delayed.release();
   expect((await response).status).toBe(403);expect((await s.db.aiAccessPolicy.findUniqueOrThrow({where:{id:"site"}})).revision).toBe(current.revision);
  });
 }
});


describe.sequential("site configuration pending-body authorization",()=>{
 for(const endpoint of ["edit","import","deduplicate"] as const){
  for(const revocation of ["sessionVersion","role"] as const){
   it(`rejects site ${endpoint} after ${revocation} changes during body reading`,async()=>{
    let body:unknown;
    if(endpoint==="import"){
     const password="synthetic-import-password",envelope=await sealExport(site(),password);
     const preview=await SITE_IMPORT(req("POST",{action:"preview",mode:"replace",envelope,password}));expect(preview.status).toBe(200);
     const p=await preview.json();body={action:"apply",mode:"replace",envelope,password,revision:p.revision,expires:p.expires,previewToken:p.previewToken};
    }else if(endpoint==="deduplicate"){
     const duplicate=site();duplicate.models.push({...duplicate.models[0],id:"duplicate"});
     await s.db.aiConfiguration.update({where:{id:"site"},data:{payload:protect(duplicate)}});
     const preview=await SITE_DEDUP(req("POST",{action:"preview",choices:[]}));expect(preview.status).toBe(200);
     const p=await preview.json();expect(p.changed).toBe(true);body={action:"apply",choices:[],revision:p.revision,expires:p.expires,nonce:p.nonce,previewToken:p.previewToken};
    }else body={revision:1,config:site()};
    const before=await s.db.aiConfiguration.findUniqueOrThrow({where:{id:"site"}});
    const delayed=delayedBody(body),response=(endpoint==="edit"?SITE_POST:endpoint==="import"?SITE_IMPORT:SITE_DEDUP)(delayed.request);
    await delayed.reading;await s.db.user.update({where:{id:"admin"},data:revocation==="role"?{role:"user"}:{sessionVersion:{increment:1}}});delayed.release();
    expect((await response).status).toBe(403);
    expect(await s.db.aiConfiguration.findUniqueOrThrow({where:{id:"site"}})).toEqual(before);
   });
  }
 }
});


describe.sequential('stable history reads do not reconcile by writing on each poll',()=>{
 it('keeps initialized task reads read-only and still checks live grants',async()=>{
  await grant();const job=await resultJob();await readJob('alice',job.id);
  const writes:string[]=[];let observe=true;
  s.db.$use(async(params,next)=>{if(observe && /^(create|update|upsert|delete)/.test(params.action))writes.push(params.model+':'+params.action);return next(params);});
  try { await readJob('alice',job.id,true);await readJob('alice',job.id); } finally {observe=false;}
  expect(writes).toEqual([]);
  await s.db.aiUserModelGrant.deleteMany({where:{userId:'alice'}});
  await expect(readJob('alice',job.id)).rejects.toThrow('AI_MODEL_ACCESS_REVOKED');
 });
});
