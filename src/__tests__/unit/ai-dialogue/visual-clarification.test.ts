// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const chain = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/chain", () => ({ callChain: chain }));
import { advanceDialogue } from "@/lib/ai-dialogue/pipeline";
import { DecisionSchema, RECOGNIZE_PROMPT, solvePrompt } from "@/lib/ai-dialogue/protocol";
import { aiRun } from "@/lib/ai-jobs/context";
import { JobInputSchema } from "@/lib/ai-jobs/schema";
import type { DialoguePayload } from "@/lib/ai-dialogue/types";
const transcript = { text:"synthetic diagram", facts:[], uncertainties:[], missingInformation:[] };
const solved = { status:"solved", result:{ questionText:"synthetic q",answerText:"a",analysis:"explanation",subject:"数学",knowledgePoints:[] } };
const doubts = ["The angle is marked by an arc, not a written ray pair"];
const payload = (): DialoguePayload => ({ input:JobInputSchema.parse({questionText:"synthetic q",imageBase64:"data:image/png;base64,YQ==",originalImageBase64:"data:image/png;base64,Yg=="}),messages:[],questions:[],rereads:0 });
function replies(values: unknown[]) {
 chain.mockImplementation(async (_p,_t,_i,parse,opts) => {
  aiRun.getStore()!.lastModel=opts.modelId || (opts.role==="recognize"?"reader":opts.stage==="review"?"reviewer":"solver");
  if(!values.length)throw new Error("UNEXPECTED_EXTRA_CALL");
  return parse(JSON.stringify(values.shift()));
 });
}
async function run(p: DialoguePayload, multimodal=true, checkpoint=vi.fn(async()=>{})) {
 return aiRun.run({config:{version:1,providers:[],models:["solver","reviewer"].map(id=>({id,providerId:"p",name:id,model:id,enabled:true,capabilities:multimodal?["text","vision"]:["text"]})),chains:{text:["solver","reviewer"],vision:[]}},signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:6},()=>advanceDialogue(p,checkpoint));
}
beforeEach(()=>{ chain.mockReset(); });
describe("visual evidence is checked before asking the human",()=>{
 it("does not promote a reader's missing-text allegation to a human question",async()=>{
  replies([{...transcript,missingInformation:doubts},solved]);const p=payload();
  expect((await run(p)).state).toBe("answered");expect(chain).toHaveBeenCalledTimes(2);
  expect(chain.mock.calls[1][2]).toBe(p.input.imageBase64);expect(chain.mock.calls[1][1]).toContain(doubts[0]);
 });
 it.each([undefined,"image_unclear"])("rereads with the same visual solver when needs_user reason is %s",async(reason)=>{
  replies([transcript,{status:"needs_user",reason,questions:doubts},solved]);const p=payload();
  expect((await run(p)).state).toBe("answered");expect(p.rereads).toBe(1);
  expect(chain.mock.calls[2][2]).toBe(p.input.originalImageBase64);
  expect(chain.mock.calls[2][4]).toMatchObject({stage:"reread",modelId:"solver",question:doubts});
 });
 it("passes a text solver's doubts to vision and lets the solver assess even an inconclusive reread",async()=>{
  replies([transcript,{status:"needs_user",questions:doubts},{...transcript,missingInformation:doubts},solved]);const p=payload();
  expect((await run(p,false)).state).toBe("answered");expect(chain).toHaveBeenCalledTimes(4);
  expect(chain.mock.calls[2][4]).toMatchObject({role:"recognize",stage:"reread",question:doubts});
  expect(chain.mock.calls[2][2]).toBe(p.input.originalImageBase64);
  expect(chain.mock.calls[3][4]).toMatchObject({role:"solve",modelId:"solver"});
 });
 it.each(["missing_source","user_choice"])("avoids a visual loop for a confirmed %s",async(reason)=>{
  replies([transcript,{status:"needs_user",reason,questions:doubts}]);
  expect((await run(payload())).state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(2);
 });
 it("still asks after one unsuccessful visual check instead of fabricating a solution",async()=>{
  replies([transcript,{status:"needs_user",questions:doubts},{status:"needs_user",questions:doubts}]);const p=payload();
  expect((await run(p)).state).toBe("awaiting_user");expect(p.questions).toEqual(doubts);expect(chain).toHaveBeenCalledTimes(3);
 });
 it("does not reset the reread allowance on continuation",async()=>{
  const p=payload();p.transcript=transcript;p.rereads=1;replies([{status:"needs_user",questions:doubts}]);
  expect((await run(p)).state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(1);
 });
 it("does not dispatch vision when there is no picture",async()=>{
  const p=payload();delete p.input.imageBase64;delete p.input.originalImageBase64;replies([{status:"needs_user",questions:doubts}]);
  expect((await run(p)).state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(1);
 });
 it("checkpoints the allowance before rereading, and never retries acceptance-unknown",async()=>{
  const p=payload();let savedAllowance=false;
  const checkpoint=vi.fn(async()=>{if(p.rereads===1)savedAllowance=true;});
  replies([transcript,{status:"needs_user",questions:doubts}]);
  const original=chain.getMockImplementation()!;
  chain.mockImplementation(async(...args)=>{if(args[4].stage==="reread"){expect(savedAllowance).toBe(true);throw new Error("AI_ACCEPTANCE_UNKNOWN");}return original(...args);});
  await expect(run(p,true,checkpoint)).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");expect(chain).toHaveBeenCalledTimes(3);
 });
 it("lets a multimodal independent reviewer reread without replacing the original solver",async()=>{
  const p=payload();p.input.review=true;replies([transcript,solved,{status:"needs_user",questions:doubts},solved]);
  expect((await run(p)).state).toBe("answered");expect(p.solverId).toBe("solver");expect(p.reviewDone).toBe(true);
  expect(chain.mock.calls[3][4]).toMatchObject({stage:"reread",modelId:"reviewer"});
  expect(chain.mock.calls[3][0]).toContain("独立复核");expect(chain.mock.calls[3][1]).toContain("候选答案");
 });
 it("returns a text reviewer's visual findings to that reviewer, not the original solver",async()=>{
  const p=payload();p.input.review=true;replies([transcript,solved,{status:"needs_user",questions:doubts},transcript,solved]);
  expect((await run(p,false)).state).toBe("answered");expect(p.solverId).toBe("solver");
  expect(chain.mock.calls[4][4]).toMatchObject({stage:"review",modelId:"reviewer"});
 });
 it("shares the single reread allowance with independent review",async()=>{
  const p=payload();p.input.review=true;replies([transcript,{status:"needs_visual_check",questions:doubts},solved,{status:"needs_user",questions:doubts}]);
  expect((await run(p)).state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(4);expect(p.rereads).toBe(1);
 });
});
describe("geometry-reading contract",()=>{
 it("recognizes graphic marks and separates reading them from guessing by shape",()=>{
  for(const prompt of [RECOGNIZE_PROMPT,solvePrompt("五年级")]){
   for(const term of ["角弧","两条射线","直角框","等长刻痕","不需要文字重复","颜色本身","外观或比例"])expect(prompt).toContain(term);
  }
  expect(solvePrompt()).toContain("转录不是最终事实");expect(solvePrompt()).toContain("missing_source");
 });
 it.each(["image_unclear","missing_source","user_choice"])("retains structured needs_user reason %s",(reason)=>{
  expect(DecisionSchema.parse({status:"needs_user",reason,questions:doubts})).toMatchObject({reason});
 });
 it("accepts legacy decisions without a reason and rejects unknown reasons",()=>{
  expect(DecisionSchema.safeParse({status:"needs_user",questions:doubts}).success).toBe(true);
  expect(DecisionSchema.safeParse({status:"needs_user",reason:"made_up",questions:doubts}).success).toBe(false);
 });
});
