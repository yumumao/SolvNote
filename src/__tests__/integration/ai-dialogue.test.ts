// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
const shared = vi.hoisted(() => ({ db: null as unknown as PrismaClient, send: vi.fn(), authId:"alice" as string|null }));
vi.mock("@/lib/prisma",()=>({get prisma(){return shared.db;}}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("next-auth",()=>({getServerSession:async()=>shared.authId?{user:{id:shared.authId}}:null}));
vi.mock("@/lib/config",()=>({getAppConfig:()=>({})}));
vi.mock("@/lib/ai/transport",async original=>({...await original<typeof import("@/lib/ai/transport")>(),sendAI:shared.send}));
import { createConversation, readConversation, actConversation, updateDefaults, deleteConversation } from "@/lib/ai-dialogue/store";
import { processOne, claimJob } from "@/lib/ai-jobs/worker";
import { saveAIConfig } from "@/lib/ai-config/store";
import { POST as POSTCONVERSATION, GET as LIST } from "@/app/api/ai/conversations/route";
import { POST as ACTION, GET as GETCONVERSATION, DELETE } from "@/app/api/ai/conversations/[id]/route";
import { POST as SETTINGS } from "@/app/api/ai/dialogue-settings/route";
import { loadAIConfig } from "@/lib/ai-config/store";
import { readJob, cancelJob } from "@/lib/ai-jobs/store";
import { masterKey } from "@/lib/ai-config/vault";
import { AIError } from "@/lib/ai/transport";
const image="data:image/png;base64,YQ==";
const transcript={text:"synthetic triangle",facts:[],uncertainties:[],missingInformation:[]};
const solved={status:"solved",result:{questionText:"synthetic q",answerText:"synthetic a",analysis:"synthetic explanation",subject:"数学",knowledgePoints:[]}};
let oldDir:string|undefined;
const oldOrigin=process.env.NEXTAUTH_URL;
const origin="https://notebook.example.invalid";
function req(path="/api/ai/conversations",body:unknown={questionText:"fixture"},headers:Record<string,string>={}){return new Request(origin+path,{method:"POST",headers:{"content-type":"application/json",origin,"x-request-id":key(),...headers},body:JSON.stringify(body)});}
let seq=0;
const key=()=>`synthetic-${++seq}`;
async function captureAiIsolation(){
 return shared.db.$transaction(async tx=>({
  siteConfig:await tx.aiConfiguration.findUnique({where:{id:"site"}}),
  drawingConfig:await tx.aiConfiguration.findUnique({where:{id:"notebook-drawing"}}),
  policy:await tx.aiAccessPolicy.findUnique({where:{id:"site"}}),
  siteModels:await tx.aiSiteModelAccess.findMany(),
  grants:await tx.aiUserModelGrant.findMany(),
 }));
}
async function restoreAiIsolation(snapshot:Awaited<ReturnType<typeof captureAiIsolation>>){
 await shared.db.$transaction(async tx=>{
  // saveAIConfig reconciles site metadata and can add temporary model rows;
  // restore the whole access snapshot so later dialogue tests keep their grants.
  await tx.aiUserModelGrant.deleteMany();
  await tx.aiSiteModelAccess.deleteMany();
  await tx.aiAccessPolicy.deleteMany({where:{id:"site"}});
  await tx.aiConfiguration.deleteMany({where:{id:{in:["site","notebook-drawing"]}}});
  if(snapshot.siteConfig)await tx.aiConfiguration.create({data:snapshot.siteConfig});
  if(snapshot.drawingConfig)await tx.aiConfiguration.create({data:snapshot.drawingConfig});
  if(snapshot.policy)await tx.aiAccessPolicy.create({data:snapshot.policy});
  for(const row of snapshot.siteModels)await tx.aiSiteModelAccess.create({data:row});
  for(const row of snapshot.grants)await tx.aiUserModelGrant.create({data:row});
 });
}
async function create(user="alice", withImage=true){return createConversation(user,{questionText:"synthetic q",...(withImage?{imageBase64:image}:{})},key());}
async function view(id:string,user="alice"){return (await readConversation(user,id))!;}
async function act(id:string,kind:string,extra:Record<string,unknown>={},user="alice",requestKey=key()) { const c=await view(id,user);return actConversation(user,id,{kind,revision:c.revision,...extra},requestKey); }
beforeAll(async()=>{
 mkdirSync(".codex/tmp",{recursive:true}); const dir=mkdtempSync(path.resolve(".codex/tmp/dialogue-db-"));
 oldDir=process.env.AI_CONFIG_DIR;process.env.AI_CONFIG_DIR=path.join(dir,"config");
 const url=`file:${path.join(dir,"test.db").replaceAll("\\","/")}`;
 execFileSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env:{...process.env,DATABASE_URL:url},stdio:"pipe"});
 shared.db=new PrismaClient({datasources:{db:{url}}});
 for(const id of ["alice","bob","admin"]) await shared.db.user.create({data:{id,email:`${id}@example.invalid`,password:"unused",role:id==="admin"?"admin":"user"}});
 masterKey(true);
 await saveAIConfig({version:1,providers:[{id:"p",name:"Fixture connection",protocol:"chat",baseUrl:"https://example.com/v1",apiKey:"synthetic-only",enabled:true}],models:[
 {id:"t",providerId:"p",name:"Text solver",model:"text",capabilities:["text"],enabled:true},
 {id:"v",providerId:"p",name:"Image reader",model:"vision",capabilities:["text","vision"],enabled:true}],chains:{text:["t","v"],vision:["v"]}},0);
},30000);
beforeEach(async()=>{
 shared.authId="alice";process.env.NEXTAUTH_URL=origin;
 await shared.db.aiConversation.deleteMany();await shared.db.aiJob.deleteMany();await shared.db.aiWorkerLease.deleteMany();await shared.db.aiCooldown.deleteMany();await shared.db.aiDialogueSettings.deleteMany();
 shared.send.mockReset();shared.send.mockImplementation(async (_p,_m,prompt)=>JSON.stringify(prompt.includes("只负责题图")?transcript:solved));
});
afterAll(async()=>{if(oldOrigin===undefined)delete process.env.NEXTAUTH_URL;else process.env.NEXTAUTH_URL=oldOrigin;await shared.db?.$disconnect();if(oldDir===undefined)delete process.env.AI_CONFIG_DIR;else process.env.AI_CONFIG_DIR=oldDir;});
describe.sequential("persistent dialogue with synthetic SQLite and mocked providers",()=>{
 it("counts the first completed answer, routes text solver without image, encrypts trace",async()=>{
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(c.roundsUsed).toBe(1);expect(c.roundLimit).toBe(10);
  expect(shared.send.mock.calls.map(c=>c[1].id)).toEqual(["v","t"]);expect(shared.send.mock.calls.map(c=>c[7])).toEqual(["transcription",undefined]);expect(shared.send.mock.calls[1][4]).toBeUndefined();
  expect(c.steps.map(s=>s.stage)).toEqual(["recognize","solve"]);expect(c.steps[0].providerName).toBe("Fixture connection");
  const raw=await shared.db.aiConversation.findUniqueOrThrow({where:{id}});expect(raw.payload).not.toContain("synthetic q");
  const attempt=await shared.db.aiAttempt.findFirstOrThrow();expect(attempt.metadata).not.toContain("Fixture connection");
  expect(JSON.stringify(c)).not.toContain("synthetic-only");
 });
 it("releases the worker while awaiting a person, saves clarification without AI and resumes same round",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify({status:"needs_user",reason:"missing_source",questions:["missing length?"]}));
  const id=await create();await processOne();let c=await view(id);expect(c.state).toBe("awaiting_user");expect(c.roundsUsed).toBe(0);
  expect((await shared.db.aiWorkerLease.findUniqueOrThrow({where:{id:"site"}})).until.getTime()).toBe(0);
  await act(id,"save",{text:"length is 5"});expect(shared.send).toHaveBeenCalledTimes(2);
  await act(id,"continue");await processOne();c=await view(id);expect(c.roundsUsed).toBe(1);expect(c.roundAttempts).toBe(3);
  expect(shared.send.mock.calls[2][1].id).toBe("t");expect(shared.send.mock.calls[2][3]).toContain("length is 5");
 });
 it("executes recognition, solve, targeted reread, original solver in four calls",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify({status:"needs_visual_check",questions:["angle label?"]})).mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify(solved));
  const id=await create();await processOne();const c=await view(id);expect(c.state).toBe("answered");expect(c.roundAttempts).toBe(4);
  expect(shared.send.mock.calls.map(c=>c[1].id)).toEqual(["v","t","v","t"]);expect(c.steps[2].questions).toEqual(["angle label?"]);
 });
 it("lets the solver confirm cropped material without an unnecessary reread",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,missingInformation:["missing right half"]})).mockResolvedValueOnce(JSON.stringify({status:"needs_user",reason:"missing_source",questions:["missing right half"]}));const id=await create();await processOne();
  expect((await view(id)).questions).toEqual(["missing right half"]);expect(shared.send).toHaveBeenCalledTimes(2);
 });
 it("does not turn a reader's missing-caption warning into an automatic human pause",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,missingInformation:["synthetic arc has no written ray pair"]}));
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(c.steps.map(s=>s.stage)).toEqual(["recognize","solve"]);expect(c.roundAttempts).toBe(2);
 });
 it("records the exact question when a legacy needs_user is routed through vision",async()=>{
  const questions=["synthetic angle arc endpoints?"];
  shared.send.mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify({status:"needs_user",questions})).mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify(solved));
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(c.roundAttempts).toBe(4);expect(c.steps.map(s=>s.stage)).toEqual(["recognize","solve","reread","solve"]);
  expect(c.steps[2].questions).toEqual(questions);expect(shared.send.mock.calls[3][1].id).toBe("t");
 });
 it("enforces 10 completed rounds and only an actual administrator can extend their own conversation",async()=>{
  const id=await create("admin",false);await processOne();
  for(let i=1;i<10;i++){await act(id,"ask",{text:`follow up ${i}`},"admin");await processOne();}
  expect((await view(id,"admin")).roundsUsed).toBe(10);
  await expect(act(id,"ask",{text:"eleventh"},"admin")).rejects.toThrow("DIALOGUE_ROUND_LIMIT");
  await act(id,"extend_rounds",{amount:2},"admin");await act(id,"ask",{text:"eleventh"},"admin");await processOne();expect((await view(id,"admin")).roundsUsed).toBe(11);
  const user=await create();await expect(act(user,"extend_rounds",{amount:2})).rejects.toThrow("FORBIDDEN");
 },15000); // Eleven persisted rounds can exceed 5s under parallel SQLite test load.
 it("snapshots defaults without changing existing limits",async()=>{
  const id=await create();await updateDefaults("admin",{defaultRounds:15,revision:0});expect((await view(id)).roundLimit).toBe(10);
  expect((await view(await create())).roundLimit).toBe(15);await expect(updateDefaults("alice",{defaultRounds:99,revision:1})).rejects.toThrow("FORBIDDEN");
 });
 it("deduplicates creation and rejects different data under a reused key",async()=>{
  const k=key(),raw={questionText:"q"};const id=await createConversation("alice",raw,k);expect(await createConversation("alice",raw,k)).toBe(id);
  await expect(createConversation("alice",{questionText:"different"},k)).rejects.toThrow("REQUEST_CONFLICT");
 });
 it("deduplicates actions and rejects stale revisions before dispatch",async()=>{
  const id=await create();await processOne();const c=await view(id),k=key(),action={kind:"ask",text:"why",revision:c.revision};
  await actConversation("alice",id,action,k);await actConversation("alice",id,action,k);
  expect(await shared.db.aiJob.count({where:{conversationId:id}})).toBe(2);
  await expect(actConversation("alice",id,{...action,text:"different"},k)).rejects.toThrow("REQUEST_CONFLICT");
  await expect(actConversation("alice",id,action,key())).rejects.toThrow("DIALOGUE_CONFLICT");
 });
 it("denies cross-user reads, writes and deletion",async()=>{
  const id=await create();expect(await readConversation("bob",id)).toBeNull();
  await expect(actConversation("bob",id,{kind:"cancel",revision:0},key())).rejects.toThrow("NOT_FOUND");
  await expect(deleteConversation("bob",id,0)).rejects.toThrow("NOT_FOUND");
 });
 it("never repeats a request with unknown acceptance",async()=>{
  shared.send.mockRejectedValue(new AIError("AI_ACCEPTANCE_UNKNOWN"));const id=await create();await processOne();expect((await view(id)).state).toBe("unknown");
  await expect(act(id,"continue")).rejects.toThrow("DIALOGUE_UNKNOWN");expect(await processOne()).toBe(false);expect(shared.send).toHaveBeenCalledTimes(1);
 });
 it("keeps unknown state through lease recovery, rather than restarting recognition",async()=>{
  const id=await create();const job=await claimJob("crashed");await shared.db.aiJob.update({where:{id:job!.id},data:{leaseUntil:new Date(0)}});await shared.db.aiWorkerLease.update({where:{id:"site"},data:{until:new Date(0)}});
  await processOne("replacement");expect((await view(id)).state).toBe("unknown");expect(shared.send).not.toHaveBeenCalled();
 });
 it("does not reset call or active-time limits after human input",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,missingInformation:["missing length"]})).mockResolvedValueOnce(JSON.stringify({status:"needs_user",reason:"missing_source",questions:["missing length"]}));const id=await create();await processOne();
  await shared.db.aiConversation.update({where:{id},data:{roundAttempts:6}});await act(id,"save",{text:"length 5"});
  await expect(act(id,"continue")).rejects.toThrow("DIALOGUE_CALL_LIMIT");expect(shared.send).toHaveBeenCalledTimes(2);
 });
 it("cancels a pending turn without an AI call or consuming a round",async()=>{
  const id=await create();await act(id,"cancel");expect((await view(id)).state).toBe("cancelled");expect((await view(id)).roundsUsed).toBe(0);expect(await processOne()).toBe(false);
 });
 it("only restores image data on demand, and delete cascades encrypted history",async()=>{
  const id=await create();await processOne();expect((await view(id)).input.imageBase64).toBeUndefined();
  expect((await readConversation("alice",id,true))?.input.imageBase64).toBe(image);
  await deleteConversation("alice",id,(await view(id)).revision);
  expect(await shared.db.aiJob.count({where:{conversationId:id}})).toBe(0);expect(await shared.db.aiConversationAction.count({where:{conversationId:id}})).toBe(0);
 });
 it("refuses old short-job routes for dialogue tasks",async()=>{
  const id=await create(),job=(await view(id)).activeJobId!;
  expect(await readJob("alice",job,true)).toBeNull();expect(await cancelJob("alice",job)).toBeNull();expect((await shared.db.aiJob.findUniqueOrThrow({where:{id:job}})).cancelRequested).toBe(false);
 });
 it("uses original quality for targeted rereads and invalidates transcription on a replacement image",async()=>{
  const original="data:image/png;base64,Yg==";
  shared.send.mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify({status:"needs_visual_check",questions:["label?"]})).mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify({status:"needs_user",questions:["missing half?"]}));
  const id=await createConversation("alice",{questionText:"q",imageBase64:image,originalImageBase64:original},key());await processOne();
  expect(shared.send.mock.calls[2][4]).toBe(original);
  const previous=(await view(id)).roundAttempts;await act(id,"save",{imageBase64:original});expect(shared.send).toHaveBeenCalledTimes(4);
  await act(id,"continue");await processOne();expect(shared.send.mock.calls[4][2]).toContain("只负责题图");expect((await view(id)).roundAttempts).toBe(previous+2);
 });
 it("never switches a disabled original solver silently",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({status:"needs_user",questions:["condition?"]}));const id=await create("alice",false);await processOne();
  const {config:original}=await loadAIConfig();const revision=await shared.db.aiConfiguration.findUniqueOrThrow({where:{id:"site"}});
  await saveAIConfig({...original,models:original.models.map(m=>m.id==="t"?{...m,enabled:false}:m),chains:{...original.chains,text:["v"]}},revision.revision);
  try{await expect(act(id,"continue",{text:"condition provided"})).rejects.toThrow("AI_MODEL_ACCESS_REVOKED");await expect(view(id)).rejects.toThrow("AI_MODEL_ACCESS_REVOKED");expect(shared.send).toHaveBeenCalledTimes(1);}
  finally{await saveAIConfig(original,revision.revision+1);await shared.db.aiSiteModelAccess.update({where:{modelId:"t"},data:{isAllowed:true}});}
 });
 it("bounds administrator budget extension, never dispatches on extension alone",async()=>{
  const id=await create("admin",false);await shared.db.aiConversation.update({where:{id},data:{roundAttempts:6}});await processOne();
  expect((await view(id,"admin")).state).toBe("failed");expect(shared.send).not.toHaveBeenCalled();
  await act(id,"extend_budget",{},"admin");expect((await view(id,"admin")).attemptLimit).toBe(10);expect(shared.send).not.toHaveBeenCalled();
  await act(id,"continue",{},"admin");await processOne();expect((await view(id,"admin")).roundAttempts).toBe(7);
 });
 it("saves once on concurrent stale actions and does not dispatch twice",async()=>{
  const id=await create("alice",false);await processOne();const c=await view(id);
  const results=await Promise.allSettled([1,2].map(()=>actConversation("alice",id,{kind:"ask",text:"why",revision:c.revision},key())));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(await shared.db.aiJob.count({where:{conversationId:id}})).toBe(2);
 });
 it("does not publish or count a result after cancellation wins",async()=>{
  const id=await create("alice",false);shared.send.mockImplementationOnce(async()=>{await act(id,"cancel");return JSON.stringify(solved);});await processOne();
  const c=await view(id);expect(c.state).toBe("cancelled");expect(c.roundsUsed).toBe(0);expect(c.result).toBeUndefined();expect(shared.send).toHaveBeenCalledTimes(1);
 });
 it("marks failed final persistence unknown without another charge",async()=>{
  const id=await create("alice",false),original=shared.db;let failed=false;
  shared.db=original.$extends({query:{aiJob:{$allOperations:async({args,query})=>{
   if(!failed && "data" in args && args.data && "state" in args.data && args.data.state==="success"){failed=true;throw new Error("synthetic persistence error");}return query(args);
  }}}}) as unknown as PrismaClient;
  try{await processOne();const c=await view(id);expect(failed).toBe(true);expect(c.state).toBe("unknown");expect(c.roundsUsed).toBe(0);expect(c.result).toBeUndefined();expect(shared.send).toHaveBeenCalledTimes(1);}finally{shared.db=original;}
 });
 it("rejects unauthenticated, inactive and cross-owner route access",async()=>{
  shared.authId=null;expect((await POSTCONVERSATION(req())).status).toBe(401);
  shared.authId="alice";const created=await POSTCONVERSATION(req());expect(created.status).toBe(201);const {id}=await created.json();
  shared.authId="bob";const context={params:Promise.resolve({id})};expect((await GETCONVERSATION(new Request(origin+"/api/ai/conversations/"+id),context)).status).toBe(404);
  expect((await DELETE(req("/delete",{revision:0}),context)).status).toBe(404);expect((await LIST(new Request(origin+"/list"))).status).toBe(200);
  await shared.db.user.update({where:{id:"bob"},data:{isActive:false}});try{expect((await LIST(new Request(origin+"/list"))).status).toBe(403);}finally{await shared.db.user.update({where:{id:"bob"},data:{isActive:true}});}
 });
 it("checks origin before parsing a large image body, exposes only safe errors",async()=>{
  const denied=await POSTCONVERSATION(req("/create",{questionText:"q"},{origin:"https://scandex.example.invalid","content-length":String(26*1024*1024)}));
  expect(denied.status).toBe(403);expect(await denied.json()).toEqual({message:"ORIGIN_REJECTED"});expect(await shared.db.aiConversation.count()).toBe(0);
  expect((await POSTCONVERSATION(req("/create",{}, {"content-length":String(26*1024*1024)}))).status).toBe(413);
  expect((await POSTCONVERSATION(req("/create",{questionText:""}))).status).toBe(400);
 });
 it("enforces admin settings and revision conflicts at HTTP boundaries",async()=>{
  expect((await SETTINGS(req("/settings",{defaultRounds:12,revision:0}))).status).toBe(403);
  shared.authId="admin";expect((await SETTINGS(req("/settings",{defaultRounds:12,revision:0}))).status).toBe(200);
  expect((await SETTINGS(req("/settings",{defaultRounds:12,revision:0}))).status).toBe(409);
  shared.authId="alice";const id=await create("alice",false);await processOne();
  const r=await ACTION(req("/action",{kind:"ask",revision:0,text:"why"}),{params:Promise.resolve({id})});expect(r.status).toBe(409);expect(await r.json()).toEqual({message:"DIALOGUE_CONFLICT"});
 });

});

describe.sequential("activity-budget hard limits and review clarification",()=>{
 it("does not dispatch after active time is exhausted and does not reset that budget on human save",async()=>{
  const id=await create("admin",false);
  await shared.db.aiConversation.update({where:{id},data:{roundElapsedMs:600000}});
  await processOne();expect(shared.send).not.toHaveBeenCalled();expect((await view(id,"admin")).state).toBe("failed");
  await act(id,"save",{text:"synthetic condition"},"admin");expect((await view(id,"admin")).roundElapsedMs).toBe(600000);
  await expect(act(id,"continue",{},"admin")).rejects.toThrow("DIALOGUE_CALL_LIMIT");
  await act(id,"extend_budget",{},"admin");expect(shared.send).not.toHaveBeenCalled();
  const c=await view(id,"admin");expect(c.timeLimitMs).toBe(1200000);expect(c.roundElapsedMs).toBe(600000);
  await act(id,"continue",{},"admin");await processOne();expect((await view(id,"admin")).roundsUsed).toBe(1);
 });
 it("rejects administrator expansion beyond the per-round time/call hard limits and 100 rounds",async()=>{
  const id=await create("admin",false);shared.send.mockResolvedValueOnce(JSON.stringify({status:"needs_user",questions:["missing condition"]}));await processOne();
  await act(id,"extend_budget",{},"admin");await act(id,"extend_budget",{},"admin");
  await expect(act(id,"extend_budget",{},"admin")).rejects.toThrow("DIALOGUE_LIMIT_INVALID");
  await shared.db.aiConversation.update({where:{id},data:{roundLimit:100}});
  await expect(act(id,"extend_rounds",{amount:1},"admin")).rejects.toThrow("DIALOGUE_LIMIT_INVALID");
  await shared.db.aiConversation.update({where:{id},data:{attemptLimit:18,timeLimitMs:600000}});
  await expect(act(id,"extend_budget",{},"admin")).rejects.toThrow("DIALOGUE_LIMIT_INVALID");expect(shared.send).toHaveBeenCalledTimes(1);
 });
 it("allows a text reviewer to use the visual reader without giving the original solver the review verdict",async()=>{
  const previous=await loadAIConfig();
  await saveAIConfig({...previous.config,chains:{text:["v","t"],vision:["v"]}},previous.revision);
  try {
   const questions=["synthetic arc endpoints?"];
   shared.send.mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify(solved)).mockResolvedValueOnce(JSON.stringify({status:"needs_user",questions})).mockResolvedValueOnce(JSON.stringify(transcript)).mockResolvedValueOnce(JSON.stringify(solved));
   const id=await createConversation("alice",{questionText:"synthetic q",imageBase64:image,review:true},key());
   await processOne();const c=await view(id);
   expect(c.state).toBe("answered");expect(c.roundAttempts).toBe(5);
   expect(shared.send.mock.calls.map(c=>c[1].id)).toEqual(["v","v","t","v","t"]);
   expect(c.steps.map(s=>s.stage)).toEqual(["recognize","solve","review","reread","review"]);
   expect(shared.send.mock.calls[4][2]).toContain("独立复核");expect(shared.send.mock.calls[4][4]).toBeUndefined();
  } finally {const current=await loadAIConfig();await saveAIConfig(previous.config,current.revision);}
 });
 it("does not expose the candidate answer while an independent reviewer is asking the user",async()=>{
  const id=await createConversation("alice",{questionText:"synthetic q",review:true},key());
  shared.send.mockResolvedValueOnce(JSON.stringify(solved)).mockResolvedValueOnce(JSON.stringify({status:"needs_user",questions:["confirm condition before final answer"]}));
  await processOne();const c=await view(id);expect(c.state).toBe("awaiting_user");expect(c.result).toBeUndefined();expect(c.roundsUsed).toBe(0);expect(c.steps.map(s=>s.stage)).toEqual(["solve","review"]);
  expect(c.messages.some(m=>m.kind==="answer")).toBe(false);expect(shared.send.mock.calls.map(c=>c[1].id)).toEqual(["t","v"]);
 });
});

describe.sequential("human corrected transcription",()=>{
 it("replaces machine facts, persists authority and re-solves without overwriting the correction",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,facts:[{detail:"old synthetic ray",source:"image"}]})).mockResolvedValueOnce(JSON.stringify({status:"needs_user",reason:"missing_source",questions:["which ray?"]}));
  const id=await create();await processOne();
  await act(id,"save",{correctedTranscript:"complete corrected synthetic question"});
  let c=await view(id);expect(c.transcript?.text).toBe("complete corrected synthetic question");expect(c.transcript?.facts).toEqual([]);expect(c.userCorrectedTranscript).toBe(true);expect(shared.send).toHaveBeenCalledTimes(2);
  shared.send.mockResolvedValueOnce(JSON.stringify({status:"needs_visual_check",questions:["old synthetic ray?"]}));
  await act(id,"continue");await processOne();c=await view(id);
  expect(c.state).toBe("awaiting_user");expect(c.transcript?.text).toBe("complete corrected synthetic question");expect(shared.send).toHaveBeenCalledTimes(3);expect(shared.send.mock.calls[2][3]).toContain('"transcriptionAuthority":"user_corrected"');
 });
 it("counts correction of an answered question as an explicit new round and rejects stale revisions",async()=>{
  const id=await create();await processOne();const revision=(await view(id)).revision;
  await act(id,"ask",{correctedTranscript:"complete replacement"});await processOne();expect((await view(id)).roundsUsed).toBe(2);
  await expect(actConversation("alice",id,{kind:"ask",revision,correctedTranscript:"stale replacement"},key())).rejects.toMatchObject({message:"DIALOGUE_CONFLICT"});
 });
 it("invalidates human authority when a new source image is submitted",async()=>{
  const id=await create();await processOne();await act(id,"ask",{correctedTranscript:"complete replacement"});await processOne();
  await act(id,"ask",{text:"replace source",imageBase64:image});const c=await view(id);expect(c.userCorrectedTranscript).not.toBe(true);expect(c.transcript).toBeUndefined();
 });
 it("does not allow non-owner corrections",async()=>{
  const id=await create();await processOne();await expect(actConversation("bob",id,{kind:"ask",revision:(await view(id)).revision,correctedTranscript:"not mine"},key())).rejects.toMatchObject({message:"NOT_FOUND"});
 });
});

// Same isolated database and provider mocks as dialogue, no real outgoing calls.
import {GET as DRAWGET,POST as DRAWSET} from "@/app/api/ai/drawing-settings/route";
import {POST as DRAW} from "@/app/api/ai/drawing/[kind]/route";
const construction={title:"fixture",points:[{id:"P",x:0,y:0},{id:"Q",x:4,y:0},{id:"R",x:1,y:3}],segments:[["P","Q"]],steps:[{description:"join",operation:{kind:"segment",a:"Q",b:"R"}}]};
describe.sequential("bounded drawing routes and jobs",()=>{
 it("restricts editing activation to admin, fails closed for chat models, and checks origin",async()=>{
  const r=await DRAWSET(req("/api/ai/drawing-settings",{modelId:"v",revision:0}));expect(r.status).toBe(403);
  shared.authId="admin";
  expect((await DRAWSET(req("/api/ai/drawing-settings",{modelId:"v",revision:0}))).status).toBe(400);
  expect((await DRAWSET(req("/api/ai/drawing-settings",{modelId:null,revision:0},{origin:"https://foreign.example.invalid"}))).status).toBe(403);
  shared.authId="alice";const v=await (await DRAWGET(req())).json();expect(v.enabled).toBe(false);expect(v).not.toHaveProperty("models");expect(JSON.stringify(v)).not.toContain("synthetic-only");
 });
 it("exposes only enabled Gemini vision models for image-edit settings",async()=>{
  shared.authId="admin";
  const isolation=await captureAiIsolation();
  const previous=await loadAIConfig({persist:false});
  const mixed={version:1,providers:[
   {id:"chat-provider",name:"Chat fixture",protocol:"chat",baseUrl:"https://chat.example.invalid/v1",apiKey:"synthetic-chat",enabled:true},
   {id:"responses-provider",name:"Responses fixture",protocol:"responses",baseUrl:"https://responses.example.invalid/v1",apiKey:"synthetic-responses",enabled:true},
   {id:"codex-provider",name:"Codex fixture",protocol:"responses_codex",baseUrl:"https://codex.example.invalid/v1",apiKey:"synthetic-codex",enabled:true},
   {id:"gemini-provider",name:"Gemini fixture",protocol:"gemini",baseUrl:"https://gemini.example.invalid/v1beta",apiKey:"synthetic-gemini",enabled:true},
   {id:"azure-provider",name:"Azure fixture",protocol:"azure",baseUrl:"https://azure.example.invalid/openai",apiKey:"synthetic-azure",apiVersion:"2024-10-21",enabled:true},
  ],models:[
   {id:"chat-vision",providerId:"chat-provider",name:"Chat vision",model:"chat-vision",capabilities:["text","vision"],enabled:true},
   {id:"responses-vision",providerId:"responses-provider",name:"Responses vision",model:"responses-vision",capabilities:["text","vision"],enabled:true},
   {id:"codex-vision",providerId:"codex-provider",name:"Codex vision",model:"codex-vision",capabilities:["text","vision"],enabled:true},
   {id:"gemini-vision",providerId:"gemini-provider",name:"Gemini image editor",model:"gemini-image-editor",capabilities:["text","vision"],enabled:true},
   {id:"azure-vision",providerId:"azure-provider",name:"Azure vision",model:"azure-vision",capabilities:["text","vision"],enabled:true},
  ],chains:{text:["chat-vision","responses-vision","codex-vision","gemini-vision","azure-vision"],vision:["chat-vision","responses-vision","codex-vision","gemini-vision","azure-vision"]}} as Parameters<typeof saveAIConfig>[0];
  try{
   await saveAIConfig(mixed,previous.revision);
   const response=await DRAWGET(req());expect(response.status).toBe(200);
   const body=await response.json() as {models:{id:string}[]};
   expect(body.models.map(m=>m.id)).toEqual(["gemini-vision"]);
   const rejected=await DRAWSET(req("/api/ai/drawing-settings",{modelId:"responses-vision",revision:0,configRevision:previous.revision+1}));
   expect(rejected.status).toBe(400);expect(await rejected.json()).toEqual({message:"AI_IMAGE_EDIT_UNSUPPORTED"});
  }finally{
   await restoreAiIsolation(isolation);
  }
 });
 it("does not transfer site-specific image-edit authorization to an imported connection",async()=>{
  shared.authId="admin";
  const isolation=await captureAiIsolation();
  const previous=await loadAIConfig({persist:false});
  const source={version:1,providers:[{id:"source-gemini",name:"Source Gemini",protocol:"gemini",baseUrl:"https://source.example.invalid/v1beta",apiKey:"synthetic-source",enabled:true}],models:[{id:"source-image",providerId:"source-gemini",name:"Source image editor",model:"source-image",capabilities:["text","vision"],enabled:true}],chains:{text:["source-image"],vision:["source-image"]}} as Parameters<typeof saveAIConfig>[0];
  const imported={version:1,providers:[{id:"imported-gemini",name:"Imported Gemini",protocol:"gemini",baseUrl:"https://imported.example.invalid/v1beta",apiKey:"synthetic-imported",enabled:true}],models:[{id:"imported-image",providerId:"imported-gemini",name:"Imported image editor",model:"imported-image",capabilities:["text","vision"],enabled:true}],chains:{text:["imported-image"],vision:["imported-image"]}} as Parameters<typeof saveAIConfig>[0];
  try{
   await saveAIConfig(source,previous.revision);
   const before=await (await DRAWGET(req())).json() as {revision:number;configRevision:number};
   const selected=await DRAWSET(req("/api/ai/drawing-settings",{modelId:"source-image",revision:before.revision,configRevision:before.configRevision}));expect(selected.status).toBe(200);
   const current=await loadAIConfig({persist:false});await saveAIConfig(imported,current.revision);
   const after=await (await DRAWGET(req())).json() as {enabled:boolean;modelId:string;models:{id:string}[]};
   expect(after.enabled).toBe(false);expect(after.modelId).toBe("source-image");expect(after.models.map(m=>m.id)).toEqual(["imported-image"]);
  }finally{
   await restoreAiIsolation(isolation);
  }
 });
 it("persists two owner-only construction jobs, routes the base to vision and only passes locked points to the solver",async()=>{
  const base={...construction,steps:[]};
  shared.send.mockResolvedValueOnce(JSON.stringify(base)).mockResolvedValueOnce(JSON.stringify({steps:construction.steps}));
  const fields={questionText:"current edited question",answerText:"edited answer",analysis:"edited analysis",drawingCorrection:"Keep A at the top-left and AB vertical"};
  const response=await DRAW(req("/api/ai/drawing/construction",{...fields,imageBase64:image,mode:"transcribe"}),{params:Promise.resolve({kind:"construction"})});
  expect(response.status).toBe(202);const {jobId}=await response.json();await processOne();
  const job=await readJob("alice",jobId,true);expect(job?.state).toBe("success");expect(job?.result).toMatchObject({type:"construction",plan:base});
  expect(job?.input).toMatchObject(fields);expect(await readJob("bob",jobId)).toBeNull();
  expect(shared.send).toHaveBeenCalledTimes(1);expect(shared.send.mock.calls[0][1].id).toBe("v");
  expect(JSON.parse(shared.send.mock.calls[0][3])).toEqual({question:fields.questionText,correction:fields.drawingCorrection});
  expect(shared.send.mock.calls[0][4]).toBeTruthy();
  const second=await DRAW(req("/api/ai/drawing/construction",{...fields,drawingPlan:base}),{params:Promise.resolve({kind:"construction"})});
  expect(second.status).toBe(202);const {jobId:secondId}=await second.json();await processOne();
  const secondJob=await readJob("alice",secondId);expect(secondJob?.state).toBe("success");expect(secondJob?.result).toMatchObject({type:"construction",plan:construction});
  expect(await readJob("bob",secondId)).toBeNull();expect(shared.send).toHaveBeenCalledTimes(2);expect(shared.send.mock.calls[1][1].id).toBe("t");
  expect(JSON.parse(shared.send.mock.calls[1][3])).toEqual({question:fields.questionText,answer:fields.answerText,analysis:fields.analysis,lockedBase:base});
  expect(shared.send.mock.calls[1][4]).toBeUndefined();
  expect((job?.attemptsLog[0] as unknown as {stage:string}).stage).toBe("construction");
  expect((secondJob?.attemptsLog[0] as unknown as {stage:string}).stage).toBe("construction");
 });
 it("persists editable correction context and makes each manual regeneration a new owner-only job",async()=>{
  const previous={...construction,steps:[]};
  const corrected={...previous,points:previous.points.map(p=>p.id==="R"?{...p,x:3}:p)};
  const sameGeometry={...corrected,title:"Explanation updated, geometry unchanged"};
  shared.send.mockResolvedValueOnce(JSON.stringify(corrected)).mockResolvedValueOnce(JSON.stringify(sameGeometry));
  const fields={questionText:"synthetic diagram",answerText:"must not guide the base",analysis:"must not leak into first stage",drawingCorrection:"Move R to x=3; keep P and Q unchanged"};
  const body={...fields,imageBase64:image,drawingPreviousBase:previous};
  const requestKey=key();
  const submit=(input:typeof body,requestId=key())=>DRAW(req("/api/ai/drawing/construction",input,{"x-request-id":requestId}),{params:Promise.resolve({kind:"construction"})});
  const response=await submit(body,requestKey);expect(response.status).toBe(202);const {jobId}=await response.json();
  const retried=await submit(body,requestKey);expect(retried.status).toBe(202);expect((await retried.json()).jobId).toBe(jobId);
  await processOne();
  const first=await readJob("alice",jobId,true);expect(first?.state).toBe("success");
  expect(first?.input).toMatchObject({drawingCorrection:fields.drawingCorrection,drawingPreviousBase:previous});
  expect(first?.result).toMatchObject({type:"construction",plan:corrected});expect(await readJob("bob",jobId,true)).toBeNull();
  expect(shared.send).toHaveBeenCalledTimes(1);expect(shared.send.mock.calls[0][1].id).toBe("v");
  expect(JSON.parse(shared.send.mock.calls[0][3])).toEqual({question:fields.questionText,correction:fields.drawingCorrection,previousBase:previous});
  expect(shared.send.mock.calls[0][4]).toBeTruthy();
  const second=await submit({...body,drawingPreviousBase:corrected});expect(second.status).toBe(202);const {jobId:secondId}=await second.json();expect(secondId).not.toBe(jobId);
  await processOne();const secondJob=await readJob("alice",secondId,true);expect(secondJob?.state).toBe("success");
  expect(secondJob?.input?.drawingPreviousBase).toEqual(corrected);expect(secondJob?.result).toMatchObject({type:"construction",plan:sameGeometry});
  expect(JSON.parse(shared.send.mock.calls[1][3])).toEqual({question:fields.questionText,correction:fields.drawingCorrection,previousBase:corrected});
  expect(await readJob("bob",secondId)).toBeNull();await processOne();expect(shared.send).toHaveBeenCalledTimes(2);
 });
 it("stops unsupported drawings once without spending the fallback model budget",async()=>{
  shared.send.mockResolvedValue(JSON.stringify({unsupported:true}));
  const r=await DRAW(req("/api/ai/drawing/construction",{questionText:"synthetic unsupported curve",answerText:"synthetic answer"}),{params:Promise.resolve({kind:"construction"})});
  const {jobId}=await r.json();await processOne();const job=await readJob("alice",jobId);
  expect(job?.state).toBe("failed");expect(job?.errorCode).toBe("AI_DRAWING_UNSUPPORTED");expect(shared.send).toHaveBeenCalledTimes(1);
  expect(job?.attemptsLog[0]).toMatchObject({diagnostic:"DRAWING_UNSUPPORTED"});
 });
 it("never dispatches editing when not activated or without explicit consent",async()=>{
  const response=await DRAW(req("/api/ai/drawing/image_edit",{questionText:"fixture",imageBase64:image,drawingPlan:construction}),{params:Promise.resolve({kind:"image_edit"})});expect(response.status).toBe(400);expect(shared.send).not.toHaveBeenCalled();
 });
});

// Only synthetic config, SQLite and provider replies. This tests the durable trace,
// not a real model or the user's currently running preview.
describe.sequential("safe failure diagnostics survive the persistent worker",()=>{
 it("persists a fixed parse diagnostic encrypted and retains model/round metadata",async()=>{
  shared.send.mockResolvedValueOnce("not-json PRIVATE-RESPONSE");
  const id=await create();await processOne();const c=await view(id);
  expect(c.steps[0]).toMatchObject({state:"failed",errorCode:"AI_RESPONSE_ERROR",diagnostic:"JSON_INVALID",stage:"recognize",modelName:"Image reader",providerName:"Fixture connection",round:1});
  const attempt=await shared.db.aiAttempt.findFirstOrThrow();
  expect(attempt.metadata).not.toContain("JSON_INVALID");
  expect(JSON.stringify(c)).not.toContain("PRIVATE-RESPONSE");
 });
 it("preserves unknown status and makes no fallback dispatch on body timeout",async()=>{
  shared.send.mockRejectedValueOnce(new AIError("AI_ACCEPTANCE_UNKNOWN",false,0,"TIMEOUT_READING_BODY"));
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("unknown");
  expect(c.steps[0]).toMatchObject({state:"unknown",diagnostic:"TIMEOUT_READING_BODY"});
  await processOne();expect(shared.send).toHaveBeenCalledTimes(1);
 });
 it("accepts thinking-wrapper transcription without a paid fallback attempt",async()=>{
  shared.send.mockResolvedValueOnce(`<think>synthetic</think>\n${JSON.stringify(transcript)}`);
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("answered");
  expect(c.steps.map(s=>s.state)).toEqual(["success","success"]);
  expect(shared.send).toHaveBeenCalledTimes(2);
 });
});


// Synthetic image metadata, SQLite and provider replies only.
describe.sequential("supplemental text completes human evidence review",()=>{
 async function awaitingGeometry(){
  const geometry={regions:[],angles:[{label:"1",vertex:"Q",arms:["P","R"]}]};
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,geometry}))
   .mockResolvedValueOnce(JSON.stringify({angles:geometry.angles,geometryUncertainties:["编号角1的射线仍需核对"]}));
  const pixels=await sharp({create:{width:80,height:60,channels:3,background:"white"}}).png().toBuffer();
  const id=await createConversation("alice",{questionText:"synthetic q",imageBase64:`data:image/png;base64,${pixels.toString("base64")}`},key());
  await processOne();expect((await view(id)).state).toBe("awaiting_user");return id;
 }
 it("continues with the supplement and original transcription instead of replacing the whole question",async()=>{
  const id=await awaitingGeometry();await act(id,"continue",{text:"Angle 1 uses ray QS; retain other conditions."});await processOne();
  const c=await view(id);expect(c.state).toBe("answered");expect(c.roundsUsed).toBe(1);expect(c.transcript?.text).toBe(transcript.text);
  expect(c.userCorrectedTranscript).not.toBe(true);expect(c.transcriptClarifications).toEqual(["Angle 1 uses ray QS; retain other conditions."]);
  expect(shared.send).toHaveBeenCalledTimes(3);expect(c.steps.map(s=>s.stage)).toEqual(["recognize","geometry_check","solve"]);
  const sent=JSON.parse(shared.send.mock.calls[2][3]);expect(sent.transcription.text).toBe(transcript.text);
  expect(sent.transcriptionClarifications).toEqual(c.transcriptClarifications);expect(sent.transcriptionAuthority).toBe("user_clarified");
 });
 it("saves without calling AI, survives restore, and deduplicates a retried action",async()=>{
  const id=await awaitingGeometry(),revision=(await view(id)).revision,requestKey=key();
  const action={kind:"save",revision,text:"first synthetic clarification"};
  await actConversation("alice",id,action,requestKey);await actConversation("alice",id,action,requestKey);
  await act(id,"save",{text:"second synthetic clarification"});
  expect((await view(id)).transcriptClarifications).toEqual([action.text,"second synthetic clarification"]);
  expect(shared.send).toHaveBeenCalledTimes(2);await act(id,"continue");await processOne();
  expect((await view(id)).state).toBe("answered");expect(shared.send).toHaveBeenCalledTimes(3);
 });
 it("does not treat empty continuation as confirmation",async()=>{
  const id=await awaitingGeometry();await act(id,"continue",{text:"   "});await processOne();
  expect((await view(id)).state).toBe("awaiting_user");expect(shared.send).toHaveBeenCalledTimes(2);
 });
 it("clears supplemental authority when replacing the source image",async()=>{
  const id=await awaitingGeometry();await act(id,"save",{text:"old source clarification"});await act(id,"save",{imageBase64:image,text:"new source description"});
  const c=await view(id);expect(c.transcript).toBeUndefined();expect(c.transcriptClarifications||[]).toEqual([]);
 });
 it("clears supplements when a complete revised statement replaces the transcript",async()=>{
  const id=await awaitingGeometry();await act(id,"save",{text:"superseded clarification"});await act(id,"save",{correctedTranscript:"complete revised synthetic statement"});
  const c=await view(id);expect(c.transcript?.text).toBe("complete revised synthetic statement");expect(c.userCorrectedTranscript).toBe(true);expect(c.transcriptClarifications||[]).toEqual([]);
 });
 it("preserves owner and revision checks",async()=>{
  const id=await awaitingGeometry(),revision=(await view(id)).revision;
  await expect(actConversation("bob",id,{kind:"save",revision,text:"foreign"},key())).rejects.toMatchObject({message:"NOT_FOUND"});
  await act(id,"save",{text:"current"});
  await expect(actConversation("alice",id,{kind:"continue",revision,text:"stale"},key())).rejects.toMatchObject({message:"DIALOGUE_CONFLICT"});
 });
 it("carries the account's elementary grade through solving and review",async()=>{
  await shared.db.user.update({where:{id:"alice"},data:{educationStage:"primary",enrollmentYear:new Date().getFullYear()-4}});
  try{
   const id=await createConversation("alice",{questionText:"synthetic geometry",review:true},key());await processOne();
   const c=await view(id);expect(c.input.gradeSemester).toMatch(/[四五]年级/);expect(c.state).toBe("answered");
   for(const call of shared.send.mock.calls){expect(call[2]).toContain("小学奥数");expect(call[2]).toContain("sin/cos/tan");}
  }finally{await shared.db.user.update({where:{id:"alice"},data:{educationStage:null,enrollmentYear:null}});}
 });
});

describe.sequential("bounded JSON compatibility in the persistent dialogue worker",()=>{
 it("saves recovered transcription and completes without a repair/fallback AI call",async()=>{
  shared.send.mockResolvedValueOnce(String.raw`转录如下：
{"text":"synthetic $\frac{1}{2}+\theta$","facts":[],"uncertainties":[],"missingInformation":[]}
以上为转录。`);
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(shared.send).toHaveBeenCalledTimes(2);
  expect(c.transcript?.text).toBe(String.raw`synthetic $\frac{1}{2}+\theta$`);
  expect(shared.send.mock.calls[1][3]).toContain(JSON.stringify(String.raw`synthetic $\frac{1}{2}+\theta$`));
  expect(c.steps.map(step=>step.state)).toEqual(["success","success"]);
 });
 it("uses the same compatibility boundary for the targeted reread",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify(transcript))
   .mockResolvedValueOnce(JSON.stringify({status:"needs_visual_check",questions:["synthetic symbol?"]}))
   .mockResolvedValueOnce(String.raw`补读结果：{"text":"synthetic $\sqrt{4}$","facts":[],"uncertainties":[],"missingInformation":[]}`)
   .mockResolvedValueOnce(JSON.stringify(solved));
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(shared.send).toHaveBeenCalledTimes(4);
  expect(c.transcript?.text).toBe(String.raw`synthetic $\sqrt{4}$`);
 });
 it("does not persist an incomplete transcript as a checkpoint",async()=>{
  shared.send.mockResolvedValueOnce(String.raw`转录：{"text":"synthetic $\frac{1}{2}$","facts":[]`);
  const id=await create();await processOne();const c=await view(id);
  expect(c.state).not.toBe("answered");expect(c.transcript).toBeUndefined();
  expect(c.steps[0]).toMatchObject({state:"failed",diagnostic:"JSON_INVALID"});
  expect(shared.send).toHaveBeenCalledTimes(1);
 });
});

describe.sequential("explicit recovery after interrupted AI stages",()=>{
 async function interrupt(stage:"recognize"|"geometry_check"|"solve",user="alice"){
  const geometry={regions:[],angles:[{label:"1",vertex:"Q",arms:["P","R"]}]};
  if(stage!=="recognize")shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,...(stage==="geometry_check"?{geometry}:{})}));
  shared.send.mockRejectedValueOnce(new AIError("AI_ACCEPTANCE_UNKNOWN",false,0,"TIMEOUT_READING_BODY"));
  const pixels=await sharp({create:{width:80,height:60,channels:3,background:"white"}}).png().toBuffer();
  const id=await createConversation(user,{questionText:"synthetic q",imageBase64:`data:image/png;base64,${pixels.toString("base64")}`},key());await processOne();return id;
 }
 it.each(["recognize","geometry_check","solve"] as const)("retries only the interrupted %s checkpoint after explicit confirmation",async stage=>{
  const id=await interrupt(stage),old=await view(id);expect(old.state).toBe("unknown");
  await expect(act(id,"retry")).rejects.toThrow("DIALOGUE_RETRY_CONFIRM_REQUIRED");
  await expect(act(id,"continue")).rejects.toThrow("DIALOGUE_UNKNOWN");
  expect(await processOne()).toBe(false);
  const sent=shared.send.mock.calls.length;
  if(stage==="geometry_check")shared.send.mockResolvedValueOnce(JSON.stringify({angles:[{label:"1",vertex:"Q",arms:["P","R"]}],geometryUncertainties:[]}));
  const action={kind:"retry",revision:old.revision,confirmRisk:true};const k=key();
  await actConversation("alice",id,action,k);await actConversation("alice",id,action,k);
  expect(await shared.db.aiJob.count({where:{conversationId:id,state:"pending"}})).toBe(1);
  expect((await view(id)).roundAttempts).toBe(old.roundAttempts);
  await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(c.roundsUsed).toBe(1);
  expect(c.steps[sent].stage).toBe(stage);expect(c.steps[sent-1]).toMatchObject({state:"unknown",diagnostic:"TIMEOUT_READING_BODY"});
  expect(c.steps.filter(s=>s.stage==="recognize")).toHaveLength(stage==="recognize"?2:1);
 });
 it("preserves successful recognition and geometry when retrying a failed solve",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,geometry:{regions:[],angles:[{label:"1",vertex:"Q",arms:["P","R"]}]}}));
  shared.send.mockResolvedValueOnce(JSON.stringify({angles:[{label:"1",vertex:"Q",arms:["P","R"]}],geometryUncertainties:[]}));
  shared.send.mockRejectedValueOnce(new AIError("AI_ACCEPTANCE_UNKNOWN",false,0,"TIMEOUT_READING_BODY"));
  const pixels=await sharp({create:{width:80,height:60,channels:3,background:"white"}}).png().toBuffer();
  const id=await createConversation("alice",{questionText:"synthetic q",imageBase64:`data:image/png;base64,${pixels.toString("base64")}`},key());await processOne();
  const before=await view(id);expect(before.state).toBe("unknown");expect(before.geometryChecked).toBe(true);
  await act(id,"retry",{confirmRisk:true});await processOne();const after=await view(id);
  expect(after.state).toBe("answered");expect(after.geometryChecked).toBe(true);expect(after.transcript).toEqual(before.transcript);
  expect(after.steps.map(s=>s.stage)).toEqual(["recognize","geometry_check","solve","solve"]);
  expect(shared.send).toHaveBeenCalledTimes(4);expect(after.roundAttempts).toBe(4);
 });
 it("explicitly recovers a queued cancellation with no previous attempts",async()=>{
  const id=await create();await act(id,"cancel");const before=await view(id);
  expect(before.state).toBe("cancelled");expect(before.steps).toHaveLength(0);
  await act(id,"retry",{confirmRisk:true});await processOne();const after=await view(id);
  expect(after.state).toBe("answered");expect(after.steps.map(s=>s.stage)).toEqual(["recognize","solve"]);
  expect(shared.send).toHaveBeenCalledTimes(2);
 });
 it.each(["unknown","cancelled"])("allows saving a full correction while %s without dispatch or budget reset",async state=>{
  const id=await interrupt("geometry_check");await shared.db.aiConversation.update({where:{id},data:{state}});
  const before=await view(id),sent=shared.send.mock.calls.length;
  await act(id,"save",{correctedTranscript:"synthetic human complete correction"});
  const saved=await view(id);expect(saved.state).toBe(state);expect(saved.transcript?.text).toBe("synthetic human complete correction");
  expect(saved.roundAttempts).toBe(before.roundAttempts);expect(saved.roundElapsedMs).toBe(before.roundElapsedMs);
  expect(await processOne()).toBe(false);expect(shared.send).toHaveBeenCalledTimes(sent);
  await act(id,"retry",{confirmRisk:true});await processOne();const c=await view(id);
  expect(c.state).toBe("answered");expect(c.steps.map(s=>s.stage)).toEqual(["recognize","geometry_check","solve"]);
  expect(shared.send.mock.calls.at(-1)?.[3]).toContain("synthetic human complete correction");
 });
 it("atomically adopts correction and resumes without redoing cancelled geometry",async()=>{
  shared.send.mockResolvedValueOnce(JSON.stringify({...transcript,geometry:{regions:[],angles:[{label:"1",vertex:"Q",arms:["P","R"]}]}}));
  const pixels=await sharp({create:{width:80,height:60,channels:3,background:"white"}}).png().toBuffer();
  const id=await createConversation("alice",{questionText:"synthetic q",imageBase64:`data:image/png;base64,${pixels.toString("base64")}`},key());shared.send.mockImplementationOnce(async()=>{await act(id,"cancel");throw new AIError("AI_CANCELLED");});await processOne();
  expect((await view(id)).state).toBe("cancelled");
  await act(id,"retry",{confirmRisk:true,correctedTranscript:"human supplied angle condition"});await processOne();
  expect((await view(id)).state).toBe("answered");expect(shared.send).toHaveBeenCalledTimes(3);
 });
 it("does not bypass spent call/time budgets but permits no-call saves and admin extension",async()=>{
  const id=await interrupt("solve","admin");await shared.db.aiConversation.update({where:{id},data:{roundAttempts:6,roundElapsedMs:600000}});
  await act(id,"save",{text:"human addition"},"admin");
  await expect(act(id,"retry",{confirmRisk:true},"admin")).rejects.toThrow("DIALOGUE_CALL_LIMIT");
  await act(id,"extend_budget",{},"admin");expect(shared.send).toHaveBeenCalledTimes(2);
  await act(id,"retry",{confirmRisk:true},"admin");await processOne();expect((await view(id,"admin")).state).toBe("answered");
 });
 it("rejects unconfirmed, stale, active and cross-user recovery without creating jobs",async()=>{
  const id=await interrupt("solve"),c=await view(id);
  await expect(actConversation("bob",id,{kind:"retry",revision:c.revision,confirmRisk:true},key())).rejects.toThrow();
  await expect(actConversation("alice",id,{kind:"retry",revision:c.revision-1,confirmRisk:true},key())).rejects.toThrow("DIALOGUE_CONFLICT");
  await act(id,"retry",{confirmRisk:true});
  await expect(act(id,"retry",{confirmRisk:true})).rejects.toThrow("DIALOGUE_BUSY");
  expect(await shared.db.aiJob.count({where:{conversationId:id,state:"pending"}})).toBe(1);
 });
 it("refuses stale terminal snapshots while any job is still pending or running",async()=>{
  const id=await create();await shared.db.aiConversation.update({where:{id},data:{state:"unknown"}});
  await expect(act(id,"retry",{confirmRisk:true})).rejects.toThrow("DIALOGUE_BUSY");
  await expect(act(id,"save",{correctedTranscript:"synthetic correction"})).rejects.toThrow("DIALOGUE_BUSY");
 });
});


describe.sequential("bounded failure transport telemetry",()=>{
 it("persists only safe timing fields alongside the unknown attempt",async()=>{
  const failure=Object.assign(new AIError("AI_ACCEPTANCE_UNKNOWN",false,0,"TIMEOUT_READING_BODY"),{transport:{protocol:"chat",requestedStream:true,responseFormat:"sse",headersMs:15,firstByteMs:40,lastByteMs:41,receivedBytes:100,elapsedMs:180000,apiKey:"must-not-persist",body:"private"}});
  shared.send.mockRejectedValueOnce(failure);const id=await create();await processOne();
  const c=await view(id);expect(c.state).toBe("unknown");expect(c.steps[0]).toMatchObject({transport:{protocol:"chat",receivedBytes:100,headersMs:15}});
  expect(JSON.stringify(c.steps)).not.toContain("must-not-persist");expect(JSON.stringify(c.steps)).not.toContain('"body"');
 });
});


describe("persistent follow-up routing",()=>{
 it("stores alternating discussion and method updates, counts each round once and restores mixed context",async()=>{
  const id=await create();await processOne();const initial=await view(id);const prior=initial.result;
  await act(id,"ask",{text:"explain step",followUpMode:"auto"});shared.send.mockResolvedValueOnce(JSON.stringify({status:"discussion",text:"synthetic detail"}));await processOne();
  const detail=await view(id);expect(detail.state).toBe("answered");expect(detail.roundsUsed).toBe(2);expect(detail.roundOpen).toBe(false);expect(detail.roundAttempts).toBe(1);expect(detail.result).toEqual(prior);expect(detail.messages.at(-1)).toMatchObject({kind:"discussion",text:"synthetic detail",round:2});
  expect(detail.messages.filter(m=>m.kind==="answer")).toHaveLength(1);
  expect((await readConversation("alice",id,true))!.input.imageBase64).toBe(image);
  await act(id,"ask",{text:"another method",followUpMode:"update"});shared.send.mockResolvedValueOnce(JSON.stringify({...solved,result:{...solved.result,analysis:"changed method"}}));await processOne();
  const updated=await view(id);expect(updated.roundsUsed).toBe(3);expect(updated.result!.analysis).toBe("changed method");expect(updated.result!.answerText).toBe(prior!.answerText);expect(updated.messages.filter(m=>m.kind==="answer")).toHaveLength(2);
  const context=JSON.parse(shared.send.mock.calls.at(-1)![3]);expect(context.messages.some((m:{kind:string;text:string})=>m.kind==="discussion"&&m.text==="synthetic detail")).toBe(true);
  expect(context.followUp).toEqual({mode:"update",hasCurrentSolution:true});
  await act(id,"ask",{text:"one more detail",followUpMode:"explain"});shared.send.mockResolvedValueOnce(JSON.stringify({status:"discussion",text:"second detail"}));await processOne();
  const last=await view(id);expect(last.result).toEqual(updated.result);expect(last.roundsUsed).toBe(4);expect(last.messages.at(-1)!.kind).toBe("discussion");
 });
 it("keeps mode and spent budget through cancellation, save-only and explicit retry",async()=>{
  const c=await create();await processOne();await act(c,"ask",{text:"a detail",followUpMode:"explain"});
  shared.send.mockRejectedValueOnce(new AIError("AI_ACCEPTANCE_UNKNOWN"));await processOne();let stopped=await view(c);expect(stopped.state).toBe("unknown");const used=stopped.roundAttempts;
  await act(c,"save",{text:"clarifying my question"});expect(shared.send).toHaveBeenCalledTimes(3);
  await act(c,"retry",{confirmRisk:true});shared.send.mockResolvedValueOnce(JSON.stringify({status:"discussion",text:"recovered detail"}));await processOne();stopped=await view(c);
  expect(stopped.state).toBe("answered");expect(stopped.roundAttempts).toBe(used+1);expect(stopped.result!.analysis).toBe(solved.result.analysis);expect(JSON.parse(shared.send.mock.calls.at(-1)![3]).followUp.mode).toBe("explain");
 });
 it("preserves request idempotency, rejects changed mode and validates mode placement",async()=>{
  const id=await create();await processOne();const c=await view(id);const k=key();const action={kind:"ask",revision:c.revision,text:"why",followUpMode:"explain"};
  await actConversation("alice",id,action,k);await actConversation("alice",id,action,k);
  await expect(actConversation("alice",id,{...action,followUpMode:"update"},k)).rejects.toThrow("REQUEST_CONFLICT");
  expect(await shared.db.aiJob.count({where:{conversationId:id,state:"pending"}})).toBe(1);
  await expect(actConversation("alice",id,{kind:"cancel",revision:(await view(id)).revision,followUpMode:"update"},key())).rejects.toThrow("INVALID_REQUEST");
  await expect(actConversation("alice",id,{...action,followUpMode:"invented"},key())).rejects.toThrow();
 });
 it("legacy callers without a mode still receive discussion without rewriting the solution",async()=>{
  const id=await create();await processOne();await act(id,"ask",{text:"why"});shared.send.mockResolvedValueOnce(JSON.stringify({status:"discussion",text:"legacy detail"}));await processOne();const c=await view(id);expect(c.state).toBe("answered");expect(c.result!.analysis).toBe(solved.result.analysis);expect(c.messages.at(-1)!.kind).toBe("discussion");
 });
 it("does not accept explain mode when replacing the source and forces update for corrections",async()=>{
  const id=await create();await processOne();await expect(act(id,"ask",{text:"why",followUpMode:"explain",imageBase64:image})).rejects.toThrow("INVALID_REQUEST");
  await act(id,"ask",{correctedTranscript:"corrected synthetic q",followUpMode:"auto"});await processOne();expect(JSON.parse(shared.send.mock.calls.at(-1)![3]).followUp.mode).toBe("update");
 });
});


it.each(["auto","explain"])("keeps %s discussion clarifications out of original diagram evidence when cancelled and resumed",async followUpMode=>{
 const id=await create();await processOne();const original=await view(id);await act(id,"ask",{text:"why this step",followUpMode});await act(id,"cancel");
 const calls=shared.send.mock.calls.length;await act(id,"save",{text:"I meant the second step"});expect(shared.send).toHaveBeenCalledTimes(calls);
 expect((await view(id)).transcriptClarifications).toEqual(original.transcriptClarifications);
 await act(id,"retry",{confirmRisk:true});shared.send.mockResolvedValueOnce(JSON.stringify({status:"discussion",text:"second step detail"}));await processOne();
 const c=await view(id);expect(c.result).toEqual(original.result);expect(c.transcript).toEqual(original.transcript);expect(c.transcriptClarifications).toEqual(original.transcriptClarifications);
 expect(c.messages.some(m=>m.text==="I meant the second step")).toBe(true);expect(c.messages.at(-1)!.kind).toBe("discussion");expect(c.roundsUsed).toBe(2);
});
it("rejects a discussion in explicit update mode without another model call",async()=>{
 const id=await create();await processOne();const original=await view(id);const calls=shared.send.mock.calls.length;
 await act(id,"ask",{text:"replace method",followUpMode:"update"});shared.send.mockResolvedValueOnce(JSON.stringify({status:"discussion",text:"not a complete replacement"}));await processOne();
 const c=await view(id);expect(c.state).toBe("failed");expect(c.roundsUsed).toBe(1);expect(c.roundOpen).toBe(true);expect(shared.send).toHaveBeenCalledTimes(calls+1);expect(c.messages.filter(m=>m.kind==="answer")).toEqual(original.messages.filter(m=>m.kind==="answer"));
});


it("adopts deferred auto-mode supplements only after a complete replacement, not while saving",async()=>{
 const id=await create();await processOne();const original=await view(id);await act(id,"ask",{text:"check this label",followUpMode:"auto"});await act(id,"cancel");
 await act(id,"save",{text:"synthetic human correction: angle A is 30"});expect((await view(id)).transcriptClarifications).toEqual(original.transcriptClarifications);
 await act(id,"retry",{confirmRisk:true});shared.send.mockResolvedValueOnce(JSON.stringify({status:"solved",result:{...solved.result,questionText:""}}));await processOne();const c=await view(id);
 expect(c.state).toBe("answered");expect(c.transcriptClarifications).toContain("synthetic human correction: angle A is 30");expect(c.result!.questionText).toContain("synthetic human correction: angle A is 30");expect(c.messages.at(-1)!.kind).toBe("answer");
});
