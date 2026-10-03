// @vitest-environment node
// These minimal Prisma transaction doubles intentionally implement only the exercised delegate methods.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({db:{} as any,access:vi.fn(),send:vi.fn(),lease:true,cancel:false,finish:true}));
vi.mock("@/lib/prisma",()=>({prisma:m.db}));
vi.mock("@/lib/ai-config/vault",()=>({protect:JSON.stringify}));
vi.mock("@/lib/ai-drawing/illustration-settings",()=>({requireIllustrationAccess:m.access}));
vi.mock("@/lib/ai-drawing/minimax",()=>({sendMiniMaxImage:m.send}));
import {aiRun} from "@/lib/ai-jobs/context";
import {executeIllustration,validateIllustrationInput} from "@/lib/ai-drawing/illustration-service";
import {JobInputSchema} from "@/lib/ai-jobs/schema";
const choice={provider:{id:"p",name:"MiniMax",apiKey:"synthetic",baseUrl:"https://api.minimax.cn/v1",protocol:"chat",enabled:true},model:"image-01",fingerprint:"fp"};
const input=()=>JobInputSchema.parse({questionText:"合成配图",illustrationRevision:1,confirmIllustration:true,illustrationRatio:"1:1"});
const run=()=>aiRun.run({jobId:"j",userId:"admin",leaseOwner:"owner",deadline:Date.now()+5000,signal:new AbortController().signal,attempts:0,maxAttempts:3},()=>executeIllustration(input()));
beforeEach(()=>{vi.clearAllMocks();m.lease=true;m.cancel=false;m.finish=true;m.access.mockResolvedValue(choice);m.send.mockResolvedValue("data:image/png;base64,YQ==");
 m.db.aiWorkerLease={findFirst:vi.fn(async()=>m.lease?{}:null)};
 m.db.aiJob={findUnique:vi.fn(async()=>({id:"j",userId:"admin",kind:"illustration",cancelRequested:m.cancel})),updateMany:vi.fn(async()=>({count:m.lease?1:0}))};
 m.db.aiAttempt={create:vi.fn(async()=>({id:"a"})),updateMany:vi.fn(async()=>({count:m.finish?1:0}))};m.db.$transaction=async(f:any)=>f(m.db);
});
describe("durable media dispatch",()=>{
 it("requires explicit consent, revision and text-only bounded prompt",async()=>{
  await expect(validateIllustrationInput({...input(),confirmIllustration:undefined},"admin")).rejects.toThrow();
  await expect(validateIllustrationInput({...input(),imageBase64:"data:image/png;base64,YQ=="},"admin")).rejects.toThrow();
  await expect(validateIllustrationInput({...input(),questionText:"a".repeat(1501)},"admin")).rejects.toThrow();
 });
 it("audits one send under the lease and keeps generation out of text chains",async()=>{
  expect(await run()).toMatchObject({type:"illustration",modelName:"image-01"});expect(m.send).toHaveBeenCalledTimes(1);expect(m.db.aiAttempt.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({modelId:"media:minimax:image-01",state:"running"})}));
 });
 it.each(["lease","cancel","access"])("does not dispatch after %s loss",async kind=>{
  if(kind==="lease")m.lease=false;if(kind==="cancel")m.cancel=true;if(kind==="access")m.access.mockRejectedValue(Error("revoked"));
  await expect(run()).rejects.toThrow();expect(m.send).not.toHaveBeenCalled();
 });
 it("never retries an ambiguous transport result",async()=>{
  m.send.mockRejectedValue(Error("sensitive raw transport error"));await expect(run()).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");expect(m.send).toHaveBeenCalledTimes(1);
 });
 it("does not publish after configuration was revoked during generation",async()=>{
  m.send.mockImplementation(async()=>{m.access.mockRejectedValue(Error("revoked"));return "data:image/png;base64,YQ=="});await expect(run()).rejects.toThrow();expect(m.send).toHaveBeenCalledTimes(1);
 });
 it("marks persistence failure as unknown rather than retryable",async()=>{m.finish=false;await expect(run()).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");expect(m.send).toHaveBeenCalledTimes(1)});
});
