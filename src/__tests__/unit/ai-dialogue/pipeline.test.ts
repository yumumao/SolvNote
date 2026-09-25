// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
const chain = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/chain", () => ({callChain:chain}));
import { advanceDialogue } from "@/lib/ai-dialogue/pipeline";
import { aiRun } from "@/lib/ai-jobs/context";
import { JobInputSchema } from "@/lib/ai-jobs/schema";
import type { DialoguePayload } from "@/lib/ai-dialogue/types";
const transcript = {text:"synthetic triangle",facts:[],uncertainties:[],missingInformation:[]};
const solved = {status:"solved",result:{questionText:"q",answerText:"a",analysis:"explanation",subject:"数学",knowledgePoints:[]}};
const payload = (): DialoguePayload => ({input:JobInputSchema.parse({questionText:"q",imageBase64:"data:image/png;base64,YQ=="}),messages:[],questions:[],rereads:0});
async function run(p: DialoguePayload, multimodal=false) {
 return aiRun.run({config:{version:1,providers:[],models:[{id:"solver",providerId:"p",name:"s",model:"s",enabled:true,capabilities:multimodal?["text","vision"]:["text"]}],chains:{text:["solver"],vision:[]}},signal:new AbortController().signal,deadline:Date.now()+1000,attempts:0,maxAttempts:6},()=>advanceDialogue(p,vi.fn(async()=>{})));
}
beforeEach(()=>{ chain.mockReset(); });
function replies(values: unknown[]) { chain.mockImplementation(async (_p,_t,_i,parse,opts)=> { aiRun.getStore()!.lastModel=opts.role==="recognize"?"vision":"solver"; return parse(JSON.stringify(values.shift())); }); }
describe("dialogue decisions",()=>{
 it("transcribes before solving",async()=>{ replies([transcript,solved]); const r=await run(payload());expect(r.state).toBe("answered");expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["recognize","solve"]); });
 it("text solver requests targeted visual reread then continues with the same solver",async()=>{ replies([transcript,{status:"needs_visual_check",questions:["angle label?"]},transcript,solved]);expect((await run(payload())).state).toBe("answered");expect(chain.mock.calls[2][4].question).toEqual(["angle label?"]);expect(chain.mock.calls[3][4].modelId).toBe("solver"); });
 it("a visual solver checks its own image",async()=>{ replies([transcript,{status:"needs_visual_check",questions:["angle?"]},solved]);await run(payload(),true);expect(chain.mock.calls[2][4]).toMatchObject({stage:"reread",modelId:"solver",role:"solve"}); });
 it("only the solver confirms genuinely missing material before asking without a reread",async()=>{ replies([{...transcript,missingInformation:["right side missing"]},{status:"needs_user",reason:"missing_source",questions:["right side missing"]}]);const r=await run(payload());expect(r.state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(2); });
 it("stops after one reread rather than inventing a solution",async()=>{ replies([transcript,{status:"needs_visual_check",questions:["x?"]},transcript,{status:"needs_visual_check",questions:["x?"]}]);const r=await run(payload());expect(r.state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(4); });
 it("resumes after human clarification without repeating recognition",async()=>{ const p=payload();p.transcript=transcript;p.solverId="solver";p.messages.push({id:"m",kind:"clarification",text:"angle is 30",round:1,at:new Date().toISOString()});replies([solved]);await run(p);expect(chain).toHaveBeenCalledTimes(1);expect(chain.mock.calls[0][1]).toContain("angle is 30");expect(chain.mock.calls[0][4].modelId).toBe("solver"); });
 it("does not catch acceptance-unknown as a reason to reread",async()=>{ chain.mockRejectedValue(new Error("AI_ACCEPTANCE_UNKNOWN"));await expect(run(payload())).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");expect(chain).toHaveBeenCalledTimes(1); });
});

 it("uses the same uploaded image in initial recognition/solve, and retained original for a targeted reread",async()=>{
  const p=payload();p.input.originalImageBase64="data:image/png;base64,Yg==";
  replies([transcript,{status:"needs_visual_check",questions:["small angle label?"]},solved]);await run(p,true);
  expect(chain.mock.calls[0][2]).toBe(p.input.imageBase64);expect(chain.mock.calls[1][2]).toBe(p.input.imageBase64);expect(chain.mock.calls[2][2]).toBe(p.input.originalImageBase64);
 });

describe("image availability is explicit in the solver context", () => {
 it("tells a text solver the original is available and records the used reread budget", async () => {
  replies([transcript,{status:"needs_visual_check",questions:["synthetic mark?"]},transcript,solved]);
  await run(payload());
  expect(JSON.parse(chain.mock.calls[1][1]).imageContext).toEqual({sourceImageAvailable:true,rereadsUsed:0,rereadLimit:1});
  expect(JSON.parse(chain.mock.calls[3][1]).imageContext).toEqual({sourceImageAvailable:true,rereadsUsed:1,rereadLimit:1});
 });
 it("does not claim that an original image exists for a text-only question", async () => {
  const p=payload();p.input.imageBase64=undefined;replies([solved]);await run(p);
  expect(chain).toHaveBeenCalledTimes(1);
  expect(JSON.parse(chain.mock.calls[0][1]).imageContext).toEqual({sourceImageAvailable:false,rereadsUsed:0,rereadLimit:1});
 });
});
