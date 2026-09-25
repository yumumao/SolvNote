// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const chain=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/ai/chain",()=>({callChain:chain}));
import { advanceDialogue, dialogueContext } from "@/lib/ai-dialogue/pipeline";
import { aiRun } from "@/lib/ai-jobs/context";
import { JobInputSchema } from "@/lib/ai-jobs/schema";
import { TranscriptSchema } from "@/lib/ai-dialogue/protocol";
import type { DialoguePayload } from "@/lib/ai-dialogue/types";
const rect={x:0.2,y:0.2,width:0.5,height:0.5};
const wrong={label:"1",vertex:"Y",arms:["X","Z"],region:rect};
const correct={...wrong,arms:["X","W"]};
const transcript={text:"synthetic numbered angle",facts:[],uncertainties:[],missingInformation:[],geometry:{regions:[rect],angles:[wrong]}};
const fixed={...transcript,geometry:{regions:[rect],angles:[correct]}};
const solved={status:"solved",result:{questionText:"synthetic corrected problem",answerText:"synthetic answer",analysis:"synthetic proof",subject:"数学",knowledgePoints:[]}};
async function payload():Promise<DialoguePayload>{const b=await sharp({create:{width:300,height:240,channels:3,background:"white"}}).png().toBuffer();return {input:JobInputSchema.parse({questionText:"synthetic",imageBase64:`data:image/png;base64,${b.toString("base64")}`}),messages:[],questions:[],rereads:0};}
async function run(p:DialoguePayload){return aiRun.run({config:{version:1,providers:[],models:[],chains:{text:[],vision:[]}},signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:6},()=>advanceDialogue(p,async()=>{}));}
function replies(values:unknown[]){chain.mockImplementation(async(_p,_t,_i,parse,opts)=>{aiRun.getStore()!.lastModel=opts.role==="recognize"?"vision":"solver";return parse(JSON.stringify(values.shift()));});}
beforeEach(()=>{chain.mockReset();});
describe("numbered angle evidence, not solved-confidence",()=>{
 it("keeps the structured vertex and both rays instead of stripping them",()=>{expect(TranscriptSchema.parse(transcript)).toMatchObject({geometry:transcript.geometry});});
 it("rejects degenerate or out-of-image geometry rather than trusting it",()=>{expect(TranscriptSchema.safeParse({...transcript,geometry:{regions:[{...rect,x:2}],angles:[wrong]}}).success).toBe(false);});
 it("checks critical angles before even a confident solve, with independent context and real crops",async()=>{const p=await payload();replies([transcript,fixed,solved]);await run(p);expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["recognize","geometry_check","solve"]);const check=chain.mock.calls[1];expect(check[1]).not.toContain('"arms":["X","Z"]');expect(check[4].detailImages.length).toBeGreaterThan(0);expect(check[4].detailImages[0]).not.toBe(p.input.imageBase64);expect(JSON.parse(chain.mock.calls[2][1]).transcription.geometry.angles[0].arms).toEqual(["X","W"]);});
 it("never erases a critical angle silently when a second reader omits it",async()=>{const p=await payload();replies([transcript,{...fixed,geometry:{regions:[],angles:[]}},solved]);const result=await run(p);expect(result.state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(2);});
 it("does not repeat successful evidence check on resumption",async()=>{const p=await payload();replies([transcript,fixed,solved]);await run(p);chain.mockClear();replies([solved]);await run(p);expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["solve"]);});
 it("does not accept unresolved critical labels just because a solver would say solved",async()=>{const p=await payload();replies([transcript,{...fixed,uncertainties:["synthetic arc still hidden"]},solved]);expect((await run(p)).state).toBe("awaiting_user");expect(chain).toHaveBeenCalledTimes(2);});
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
