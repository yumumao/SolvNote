// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const chain=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/ai/chain",()=>({callChain:chain}));
import { advanceDialogue, dialogueContext } from "@/lib/ai-dialogue/pipeline";
import { aiRun } from "@/lib/ai-jobs/context";
import { JobInputSchema } from "@/lib/ai-jobs/schema";
import { TranscriptSchema } from "@/lib/ai-dialogue/protocol";
import type { DialoguePayload, Transcript } from "@/lib/ai-dialogue/types";
const rect={x:0.2,y:0.2,width:0.5,height:0.5};
const wrong={label:"1",vertex:"Y",arms:["X","Z"] as [string,string],region:rect};
const correct={...wrong,arms:["X","W"] as [string,string]};
const transcript:Transcript={text:"synthetic numbered angle",facts:[],uncertainties:[],missingInformation:[],geometry:{regions:[rect],angles:[wrong]}};
const fixed={...transcript,geometry:{regions:[rect],angles:[correct]}};
const solved={status:"solved",result:{questionText:"synthetic corrected problem",answerText:"synthetic answer",analysis:"synthetic proof",subject:"数学",knowledgePoints:[]}};
async function payload():Promise<DialoguePayload>{const b=await sharp({create:{width:300,height:240,channels:3,background:"white"}}).png().toBuffer();return {input:JobInputSchema.parse({questionText:"synthetic",imageBase64:`data:image/png;base64,${b.toString("base64")}`}),messages:[],questions:[],rereads:0};}
async function run(p:DialoguePayload){return aiRun.run({config:{version:1,providers:[],models:[],chains:{text:[],vision:[]}},signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:6},()=>advanceDialogue(p,async()=>{}));}
function replies(values:unknown[]){chain.mockImplementation(async(_p,_t,_i,parse,opts)=>{aiRun.getStore()!.lastModel=opts.role==="recognize"?"vision":"solver";return parse(JSON.stringify(values.shift()));});}
beforeEach(()=>{chain.mockReset();});
describe("numbered angle evidence, not solved-confidence",()=>{
 it("keeps the structured vertex and both rays instead of stripping them",()=>{expect(TranscriptSchema.parse(transcript)).toMatchObject({geometry:transcript.geometry});});
 it("rejects degenerate or out-of-image geometry rather than trusting it",()=>{expect(TranscriptSchema.safeParse({...transcript,geometry:{regions:[{...rect,x:2}],angles:[wrong]}}).success).toBe(false);});
 it("checks critical angles before even a confident solve, with independent context and real crops",async()=>{const p=await payload();replies([transcript,fixed,solved]);await run(p);expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["recognize","geometry_check","solve"]);const check=chain.mock.calls[1];expect(JSON.parse(check[1]).transcription.geometryHypotheses.angles[0]).toMatchObject({label:"1",vertex:"Y",arms:["X","Z"]});expect(check[4].detailImages.length).toBeGreaterThan(0);expect(check[4].detailImages[0]).not.toBe(p.input.imageBase64);expect(JSON.parse(chain.mock.calls[2][1]).transcription.geometry.angles[0].arms).toEqual(["X","W"]);});
 it("never erases a critical angle silently when a second reader omits it",async()=>{const p=await payload();replies([transcript,{...fixed,geometry:{regions:[],angles:[]}},solved]);const result=await run(p);expect(result.state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(2);});
 it("does not repeat successful evidence check on resumption",async()=>{const p=await payload();replies([transcript,fixed,solved]);await run(p);chain.mockClear();replies([solved]);await run(p);expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["solve"]);});
 it("does not block an angle after the scoped geometry check is clean",async()=>{const p=await payload();replies([transcript,{...fixed,uncertainties:["synthetic arc still hidden"]},solved]);expect((await run(p)).state).toBe("answered");expect(chain).toHaveBeenCalledTimes(3);});
 it("does not add calls for a nongeometric image",async()=>{const p=await payload();const plain={text:"synthetic prose",facts:[],uncertainties:[],missingInformation:[]};replies([plain,solved]);await run(p);expect(chain).toHaveBeenCalledTimes(2);});
});

it("uses the original image when optional coordinates fail, and still independently verifies numbered angles",async()=>{
 const p=await payload();
 const noCrop={...transcript,geometry:{regions:[{...rect,x:99}],angles:[{...wrong,region:{...rect,y:99}}]}};
 const checked={...fixed,geometry:{regions:[],angles:[correct]}};
 replies([noCrop,checked,solved]);
 expect((await run(p)).state).toBe("answered");
 expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["recognize","geometry_check","solve"]);
 expect(chain.mock.calls[1][2]).toBe(p.input.imageBase64);
 expect(chain.mock.calls[1][4].detailImages).toEqual([]);
 expect(p.geometryChecked).toBe(true);
 expect(p.transcript?.geometry?.angles[0].arms).toEqual(correct.arms);
});


describe("human supplements confirm existing transcription",()=>{
 it("sends the original transcription plus supplements straight to solving after an unresolved check",async()=>{
  const p=await payload();p.transcript={...transcript,uncertainties:["which ray?"]};p.rereads=1;p.geometryCheckStarted=true;
  p.transcriptClarifications=["The ray is YW; retain the other conditions."];
  replies([solved]);expect((await run(p)).state).toBe("answered");expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["solve"]);
  const context=JSON.parse(chain.mock.calls[0][1]);expect(context.transcription.text).toBe(transcript.text);
  expect(context.transcriptionClarifications).toEqual(p.transcriptClarifications);expect(context.transcriptionAuthority).toBe("user_clarified");
  expect(p.geometryChecked).not.toBe(true);expect(p.rereads).toBe(1);
 });
 it("still asks a specific question if the supplement is insufficient",async()=>{
  const p=await payload();p.transcript=transcript;p.transcriptClarifications=["Use the marked arc."];
  replies([{status:"needs_visual_check",questions:["Which endpoint is hidden?"]}]);
  expect((await run(p)).state).toBe("awaiting_user");expect(p.questions).toEqual(["Which endpoint is hidden?"]);
  expect(chain).toHaveBeenCalledTimes(1);expect(p.transcript).toBe(transcript);expect(p.rereads).toBe(0);
 });
 it("retains the bounded geometry guard when no supplement was supplied",async()=>{
  const p=await payload();p.transcript=transcript;p.geometryCheckStarted=true;p.rereads=1;
  expect((await run(p)).state).toBe("awaiting_user");expect(chain).not.toHaveBeenCalled();
 });
});


describe('scoped geometry uncertainty does not block unrelated solvable content',()=>{
 it('lets the solver assess noncritical transcription doubts after all angle labels are confirmed',async()=>{
  const p=await payload();const checked={...fixed,geometryUncertainties:[],uncertainties:['synthetic irrelevant handwriting unclear'],missingInformation:[]};
  replies([transcript,checked,solved]);expect((await run(p)).state).toBe('answered');
  expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(['recognize','geometry_check','solve']);
  expect(JSON.parse(chain.mock.calls[2][1]).transcription.uncertainties).toEqual([]);
 });
 it('still blocks explicit unresolved angle evidence even when generic uncertainties are empty',async()=>{
  const p=await payload();replies([transcript,{...fixed,geometryUncertainties:['synthetic label 1 has two possible rays']},solved]);
  const result=await run(p);expect(result.state).toBe('awaiting_user');expect(chain).toHaveBeenCalledTimes(2);
  expect(result.payload.questions).toContain('synthetic label 1 has two possible rays');
 });
 it('does not let an empty scoped uncertainty array excuse an omitted numbered angle',async()=>{
  const p=await payload();replies([transcript,{...fixed,geometryUncertainties:[],geometry:{regions:[],angles:[]}},solved]);
  expect((await run(p)).state).toBe('awaiting_user');expect(chain).toHaveBeenCalledTimes(2);
 });
});

describe("geometry-check transport contract",()=>{
 it("sends the first-pass geometry hypotheses and full transcription context",async()=>{
  const p=await payload();p.transcript={...transcript,text:"完整题干：在三角形ABC中……",facts:[{detail:"角1的红弧可见",source:"image"}],uncertainties:["初次识别的角1射线待核对"],missingInformation:[],geometry:transcript.geometry};
  replies([{angles:[correct],geometryUncertainties:[]},solved]);
  expect((await run(p)).state).toBe("answered");
  const request=JSON.parse(chain.mock.calls[0][1]);
  expect(request.transcription.text).toBe(p.transcript.text);
  expect(request.transcription.geometryHypotheses.angles[0]).toMatchObject({label:wrong.label,vertex:wrong.vertex,arms:wrong.arms});
  expect(request.labelsToLocate).toEqual([wrong.label]);
  expect(chain.mock.calls[0][0]).toContain("只返回下面这个严格JSON对象");
 });
 it("accepts the compact geometry-only response without requiring a second full transcript",async()=>{
  const p=await payload();replies([transcript,{angles:[correct],geometryUncertainties:[]},solved]);
  expect((await run(p)).state).toBe("answered");
  expect(p.transcript?.text).toBe(transcript.text);
  expect(p.transcript?.geometry?.angles[0]).toEqual(correct);
  expect(p.transcript?.geometryUncertainties).toEqual([]);
 });
 it("does not treat generic legacy transcription doubts as unresolved angle evidence",async()=>{
  const p=await payload();
  replies([transcript,{...fixed,uncertainties:["unrelated handwriting is unclear"],missingInformation:["optional statement omitted"]},solved]);
  expect((await run(p)).state).toBe("answered");
  expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["recognize","geometry_check","solve"]);
 });
});


describe("safe angle-label matching and source-backed solved results",()=>{
 it.each(["∠1","角1","angle 1"])("matches %s and preserves the requested label",async label=>{
  const p=await payload();replies([transcript,{angles:[{...correct,label}],geometryUncertainties:[]},solved]);
  expect((await run(p)).state).toBe("answered");
  expect(p.transcript?.geometry?.angles[0]).toEqual(correct);
 });
 it("does not pretend a missing target or an unexpected label was checked",async()=>{
  const p=await payload();replies([transcript,{angles:[{...correct,label:"2"}]},solved]);
  expect((await run(p)).state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(2);expect(p.geometryChecked).not.toBe(true);
 });
 it("does not collapse two original labels onto a single verification",async()=>{
  const p=await payload();p.transcript={...transcript,geometry:{regions:[],angles:[wrong,{...wrong,label:"∠1",arms:["X","W"]}]}};
  replies([{angles:[correct]},solved]);
  expect((await run(p)).state).toBe("awaiting_user");expect(p.geometryChecked).not.toBe(true);
  expect(p.transcript?.geometry?.angles).toEqual([wrong,{...wrong,label:"∠1",arms:["X","W"]}]);
 });
 it("restores source text when omitted and keeps the image dependency",async()=>{
  const p=await payload();replies([transcript,{angles:[correct]},{status:"solved",result:{answerText:"a",analysis:"b"}}]);
  expect((await run(p)).state).toBe("answered");
  expect(p.result?.questionText).toContain(transcript.text);expect(p.result?.requiresImage).toBe(true);
 });
 it("does not replace a complete model question with the old OCR text",async()=>{
  const p=await payload();replies([transcript,{angles:[correct]},solved]);await run(p);
  expect(p.result?.questionText).toBe(solved.result.questionText);
 });
 it("keeps human supplements if the model omits the question text",async()=>{
  const p=await payload();p.transcript=transcript;p.transcriptClarifications=["The ray is YW; keep the remaining conditions."];
  replies([{status:"solved",result:{answerText:"a",analysis:"b"}}]);await run(p);
  expect(p.result?.questionText).toContain(transcript.text);expect(p.result?.questionText).toContain(p.transcriptClarifications[0]);
 });
 it("restores a text-only source without adding an image dependency",async()=>{
  const p=await payload();p.input=JobInputSchema.parse({questionText:"synthetic full question"});
  replies([{status:"solved",result:{answerText:"a",analysis:"b"}}]);await run(p);
  expect(p.result?.questionText).toBe(p.input.questionText);expect(p.result?.requiresImage).toBe(false);
 });
 it("applies source fallback and image retention after independent review too",async()=>{
  const p=await payload();p.input.review=true;
  replies([transcript,{angles:[correct]},solved,{status:"solved",result:{answerText:"reviewed",analysis:"b"}}]);await run(p);
  expect(p.result?.questionText).toContain(transcript.text);expect(p.result?.requiresImage).toBe(true);expect(p.reviewDone).toBe(true);
 });
});


it("keeps independent initial user text alongside OCR when the solver omits its question",async()=>{
 const p=await payload();p.input.questionText="Original user condition: AB = AC.";
 replies([transcript,{angles:[correct]},{status:"solved",result:{answerText:"a",analysis:"b"}}]);
 expect((await run(p)).state).toBe("answered");
 expect(p.result?.questionText).toContain(transcript.text);
 expect(p.result?.questionText).toContain(p.input.questionText);
});
