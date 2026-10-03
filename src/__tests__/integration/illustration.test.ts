// @vitest-environment node
import {beforeAll,beforeEach,afterAll,it,expect,vi} from "vitest";
import {mkdtempSync,mkdirSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const m=vi.hoisted(()=>({db:null as unknown as PrismaClient,send:vi.fn(),text:vi.fn(),user:"admin"}));
vi.mock("@/lib/prisma",()=>({get prisma(){return m.db}}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("next-auth",()=>({getServerSession:async()=>({user:{id:m.user}})}));
vi.mock("@/lib/config",()=>({getAppConfig:()=>({})}));
vi.mock("@/lib/ai-drawing/minimax",()=>({sendMiniMaxImage:m.send}));
vi.mock("@/lib/ai/transport",async original=>({...await original<typeof import("@/lib/ai/transport")>(),sendAI:m.text}));
import {AIError} from "@/lib/ai/transport";
import {masterKey,protect,unprotect} from "@/lib/ai-config/vault";
import {saveIllustrationSettings} from "@/lib/ai-drawing/illustration-settings";
import {submitJob,readJob,cancelJob} from "@/lib/ai-jobs/store";
import {processOne,claimJob} from "@/lib/ai-jobs/worker";
import {POST} from "@/app/api/ai/drawing/[kind]/route";
const origin="https://media.example.invalid",oldDir=process.env.AI_CONFIG_DIR,oldOrigin=process.env.NEXTAUTH_URL;
const config={version:1,providers:[{id:"p",name:"Synthetic MiniMax",baseUrl:"https://api.minimax.cn/v1",apiKey:"fixture-not-real",protocol:"chat",enabled:true}],models:[],chains:{text:[],vision:[]}};
let seq=0;const input=()=>({questionText:"synthetic illustration",confirmIllustration:true,illustrationRevision:1,illustrationRatio:"1:1"});
const submit=()=>submitJob("admin","illustration",input(),`media-${++seq}`);
const disable=()=>saveIllustrationSettings("admin",{providerId:null,model:"image-01",revision:1,configRevision:1});
beforeAll(async()=>{
 mkdirSync(".codex/tmp",{recursive:true});const dir=mkdtempSync(path.resolve(".codex/tmp/illustration-db-"));process.env.AI_CONFIG_DIR=path.join(dir,"config");process.env.NEXTAUTH_URL=origin;
 const url=`file:${path.join(dir,"test.db").replaceAll("\\","/")}`;
 execFileSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env:{...process.env,DATABASE_URL:url},stdio:"pipe"});
 m.db=new PrismaClient({datasources:{db:{url}}});masterKey(true);
 for(const id of ["admin","user"])await m.db.user.create({data:{id,email:`${id}@example.invalid`,password:"unused",role:id==="admin"?"admin":"user"}});
},30000);
beforeEach(async()=>{
 vi.clearAllMocks();m.user="admin";await m.db.aiAttempt.deleteMany();await m.db.aiJob.deleteMany();await m.db.aiWorkerLease.deleteMany();await m.db.aiConfiguration.deleteMany();await m.db.user.update({where:{id:"admin"},data:{role:"admin",isActive:true}});
 await m.db.aiConfiguration.create({data:{id:"site",revision:1,payload:protect(config)}});
 await saveIllustrationSettings("admin",{providerId:"p",model:"image-01",revision:0,configRevision:1});
 m.send.mockResolvedValue("data:image/png;base64,YQ==");
});
afterAll(async()=>{await m.db?.$disconnect();if(oldDir===undefined)delete process.env.AI_CONFIG_DIR;else process.env.AI_CONFIG_DIR=oldDir;if(oldOrigin===undefined)delete process.env.NEXTAUTH_URL;else process.env.NEXTAUTH_URL=oldOrigin});
it("submits, executes and restores media without any text/vision model",async()=>{
 const job=await submit();await processOne();const got=await readJob("admin",job.id,true);
 expect(got).toMatchObject({state:"success",result:{type:"illustration"},attempts:1,input:{questionText:"synthetic illustration"}});expect(m.send).toHaveBeenCalledTimes(1);expect(m.text).not.toHaveBeenCalled();expect(await readJob("user",job.id)).toBeNull();
 await disable();expect((await readJob("admin",job.id))?.state).toBe("success");
 const raw=await m.db.aiJob.findUniqueOrThrow({where:{id:job.id}});expect(raw.result).not.toContain("imageDataUrl");expect(unprotect(raw.result!)).toMatchObject({type:"illustration"});
});
it("request id is idempotent and changed body conflicts",async()=>{
 const a=await submitJob("admin","illustration",input(),"same-request");const b=await submitJob("admin","illustration",input(),"same-request");expect(a.id).toBe(b.id);
 await expect(submitJob("admin","illustration",{...input(),questionText:"other"},"same-request")).rejects.toThrow("REQUEST_CONFLICT");await processOne();await processOne();expect(m.send).toHaveBeenCalledTimes(1);
});
it("refuses ordinary users and demoted admins on restored results",async()=>{
 await expect(submitJob("user","illustration",input(),"ordinary-user")).rejects.toThrow();const job=await submit();await processOne();await m.db.user.update({where:{id:"admin"},data:{role:"user"}});await expect(readJob("admin",job.id)).rejects.toThrow();
});
it("does not send when settings or admin access changed while queued",async()=>{const j=await submit();await disable();await processOne();expect((await readJob("admin",j.id))?.state).not.toBe("success");expect(m.send).not.toHaveBeenCalled()});
it("does not commit a result after revocation during the paid call",async()=>{const j=await submit();m.send.mockImplementation(async()=>{await disable();return "data:image/png;base64,YQ=="});await processOne();expect((await readJob("admin",j.id))?.state).not.toBe("success");expect(m.send).toHaveBeenCalledTimes(1)});
it("revalidates settings on heartbeat without ordinary-model rejection",async()=>{
 const j=await submit();m.send.mockImplementation(async()=>{await new Promise(r=>setTimeout(r,5200));return "data:image/png;base64,YQ=="});await processOne();expect((await readJob("admin",j.id))?.state).toBe("success");
},10000);
it("ambiguous transport never resends",async()=>{const j=await submit();m.send.mockRejectedValue(Error("private transport detail"));await processOne();expect((await readJob("admin",j.id))?.state).toBe("unknown");await processOne();expect(m.send).toHaveBeenCalledTimes(1)});
it("recovers a stale claimed job as unknown without dispatch",async()=>{const j=await submit();await claimJob("lost");await m.db.aiJob.update({where:{id:j.id},data:{leaseUntil:new Date(0)}});await m.db.aiWorkerLease.update({where:{id:"site"},data:{until:new Date(0)}});await processOne();expect((await readJob("admin",j.id))?.state).toBe("unknown");expect(m.send).not.toHaveBeenCalled()});
it("cancelled pending job never sends",async()=>{const j=await submit();await cancelJob("admin",j.id);await processOne();expect((await readJob("admin",j.id))?.state).toBe("cancelled");expect(m.send).not.toHaveBeenCalled()});
it("generation route handles administrator, CSRF and ordinary user correctly",async()=>{
 const req=(o=origin)=>new Request(origin+"/api/ai/drawing/illustration",{method:"POST",headers:{origin:o,"content-type":"application/json"},body:JSON.stringify(input())});const ctx={params:Promise.resolve({kind:"illustration"})};
 expect((await POST(req("https://evil.example.invalid"),ctx)).status).toBe(403);m.user="user";expect((await POST(req(),ctx)).status).toBe(403);m.user="admin";expect((await POST(req(),ctx)).status).toBe(202);
});

// Original-image description uses the existing vision chain, not the image-generation key.
async function descriptionFixture(){
 const c={...config,models:[{id:"v",providerId:"p",name:"Synthetic vision",model:"fixture-v",enabled:true,capabilities:["vision"]},{id:"v2",providerId:"p",name:"Second vision",model:"fixture-v2",enabled:true,capabilities:["vision"]}],chains:{text:[],vision:["v","v2"]}};
 await m.db.aiConfiguration.update({where:{id:"site"},data:{payload:protect(c)}});
 const sharp=(await import("sharp")).default;const png=await sharp({create:{width:3,height:3,channels:3,background:"white"}}).png().toBuffer();
 return {imageBase64:"data:image/png;base64,"+png.toString("base64"),confirmDescription:true};
}
it("describes original image once without solving or automatically generating MiniMax image",async()=>{
 const data=await descriptionFixture();m.text.mockResolvedValue(JSON.stringify({description:"一段圆弧与两条半径",uncertainties:["半径字迹不清"]}));
 const req=new Request(origin+"/api/ai/drawing/illustration_describe",{method:"POST",headers:{origin,"content-type":"application/json","x-request-id":"describe-1"},body:JSON.stringify(data)});
 const response=await POST(req,{params:Promise.resolve({kind:"illustration_describe"})});expect(response.status).toBe(202);const accepted=await response.json();await processOne();
 const got=await readJob("admin",accepted.jobId,true);expect(got).toMatchObject({state:"success",attempts:1,result:{type:"illustration_description",description:"一段圆弧与两条半径",uncertainties:["半径字迹不清"]}});
 expect(m.text).toHaveBeenCalledTimes(1);expect(m.text.mock.calls[0][4]).toBe(data.imageBase64);expect(m.send).not.toHaveBeenCalled();
 await m.db.user.update({where:{id:"admin"},data:{role:"user"}});await expect(readJob("admin",accepted.jobId)).rejects.toThrow();
});
it("description refuses ordinary users, missing confirmation and cross-origin requests",async()=>{
 const data=await descriptionFixture();const req=(d:unknown,o=origin)=>new Request(origin+"/api/ai/drawing/illustration_describe",{method:"POST",headers:{origin:o,"content-type":"application/json"},body:JSON.stringify(d)});const p={params:Promise.resolve({kind:"illustration_describe"})};
 m.user="user";expect((await POST(req(data),p)).status).toBe(403);m.user="admin";expect((await POST(req(data,"https://evil.invalid"),p)).status).toBe(403);
 expect((await POST(req({...data,confirmDescription:undefined}),p)).status).toBe(400);expect(m.text).not.toHaveBeenCalled();
});
it("description rejects cancelled and demoted queued work and never falls back after malformed paid output",async()=>{
 const data=await descriptionFixture();const a=await submitJob("admin","illustration_describe" as never,data,"describe-cancel");await cancelJob("admin",a.id);await processOne();expect(m.text).not.toHaveBeenCalled();
 await submitJob("admin","illustration_describe" as never,data,"describe-demote");await m.db.user.update({where:{id:"admin"},data:{role:"user"}});await processOne();expect(m.text).not.toHaveBeenCalled();
 await m.db.user.update({where:{id:"admin"},data:{role:"admin"}});m.text.mockResolvedValue("not JSON");const c=await submitJob("admin","illustration_describe" as never,data,"describe-malformed");await processOne();expect((await readJob("admin",c.id))?.state).toBe("failed");expect(m.text).toHaveBeenCalledTimes(1);expect(m.send).not.toHaveBeenCalled();
});

it.each(["fallback","unknown"])("description never dispatches second candidate after %s failure",async kind=>{
 const data=await descriptionFixture();m.text.mockRejectedValue(new AIError(kind==="unknown"?"AI_ACCEPTANCE_UNKNOWN":"AI_RESPONSE_ERROR",kind==="fallback"));
 const j=await submitJob("admin","illustration_describe",data,"describe-two-"+kind);await processOne();await processOne();
 expect((await readJob("admin",j.id))?.state).toBe(kind==="unknown"?"unknown":"failed");expect(m.text).toHaveBeenCalledTimes(1);expect(m.text.mock.calls[0][1].model).toBe("fixture-v");expect(m.send).not.toHaveBeenCalled();
});
it("description is idempotent and rejects changed input with the same request id",async()=>{
 const data=await descriptionFixture();const j=await submitJob("admin","illustration_describe",data,"describe-same");
 expect((await submitJob("admin","illustration_describe",data,"describe-same")).id).toBe(j.id);
 const sharp=(await import("sharp")).default;const bytes=await sharp({create:{width:4,height:4,channels:3,background:"black"}}).png().toBuffer();
 await expect(submitJob("admin","illustration_describe",{...data,imageBase64:"data:image/png;base64,"+bytes.toString("base64")},"describe-same")).rejects.toThrow("REQUEST_CONFLICT");
 m.text.mockResolvedValue(JSON.stringify({description:"synthetic",uncertainties:[]}));await processOne();await processOne();expect(m.text).toHaveBeenCalledTimes(1);
});
it.each(["admin","model","cancel"])("description does not publish after %s revocation while running",async kind=>{
 const data=await descriptionFixture();const j=await submitJob("admin","illustration_describe",data,"describe-revoke-"+kind);
 m.text.mockImplementation(async()=>{if(kind==="admin")await m.db.user.update({where:{id:"admin"},data:{role:"user"}});else if(kind==="model")await m.db.aiConfiguration.update({where:{id:"site"},data:{payload:protect(config)}});else await cancelJob("admin",j.id);return JSON.stringify({description:"synthetic",uncertainties:[]})});
 await processOne();const raw=await m.db.aiJob.findUniqueOrThrow({where:{id:j.id}});expect(raw.state).not.toBe("success");expect(raw.result).toBeNull();expect(m.text).toHaveBeenCalledTimes(1);expect(m.send).not.toHaveBeenCalled();
});
it("description history remains subject to model access",async()=>{
 const data=await descriptionFixture();m.text.mockResolvedValue(JSON.stringify({description:"synthetic",uncertainties:[]}));const j=await submitJob("admin","illustration_describe",data,"describe-history-access");await processOne();expect((await readJob("admin",j.id))?.state).toBe("success");
 await m.db.aiConfiguration.update({where:{id:"site"},data:{payload:protect(config)}});await expect(readJob("admin",j.id)).rejects.toThrow();
});
