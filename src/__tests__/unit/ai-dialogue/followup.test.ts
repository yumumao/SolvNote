// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const chain=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/ai/chain",()=>({callChain:chain}));
import { advanceDialogue, dialogueContext } from "@/lib/ai-dialogue/pipeline";
import { DecisionSchema, parseJSON, solvePrompt } from "@/lib/ai-dialogue/protocol";
import { JobInputSchema } from "@/lib/ai-jobs/schema";
import { aiRun } from "@/lib/ai-jobs/context";
import type { DialoguePayload, FollowUpMode } from "@/lib/ai-dialogue/types";
const original={questionText:"synthetic q",answerText:"4",analysis:"old method",subject:"数学" as const,knowledgePoints:[],requiresImage:false,wrongAnswerText:"",mistakeAnalysis:"",mistakeStatus:"unknown" as const};
const discussed={status:"discussion",text:"Because the synthetic angles are equal: $a=b$."};
const solved={status:"solved",result:{...original,analysis:"new method, same answer"}};
function payload(mode?:FollowUpMode):DialoguePayload{return {input:JobInputSchema.parse({questionText:"synthetic q"}),messages:[{id:"a1",kind:"answer",text:JSON.stringify(original),round:1,at:new Date(0).toISOString()},{id:"q2",kind:"question",text:"why?",round:2,at:new Date(1).toISOString()}],questions:[],rereads:0,result:structuredClone(original),...(mode?{followUpMode:mode}:{})};}
function replies(...values:unknown[]){chain.mockImplementation(async(_p,_t,_i,parse,options)=>{aiRun.getStore()!.lastModel=options.stage==="review"?"reviewer":"solver";return parse(JSON.stringify(values.shift()));});}
async function run(p:DialoguePayload){return aiRun.run({signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:6},()=>advanceDialogue(p,vi.fn(async()=>{})));}
beforeEach(()=>{chain.mockReset();});
describe("same-call follow-up routing",()=>{
 it("accepts bounded Markdown discussion using the shared JSON parser",()=>{
  expect(parseJSON(JSON.stringify(discussed),DecisionSchema)).toEqual(discussed);
  expect(DecisionSchema.safeParse({...discussed,text:" "}).success).toBe(false);
  expect(DecisionSchema.safeParse({...discussed,text:"a".repeat(70001)}).success).toBe(false);
  expect(parseJSON(String.raw`{"status":"discussion","text":"Use $\frac{1}{2}$"}`,DecisionSchema)).toEqual({status:"discussion",text:String.raw`Use $\frac{1}{2}$`});
 });
 it.each([undefined,"auto","explain"] as const)("keeps result, image and evidence in %s discussion without review/classification calls",async mode=>{
  const p=payload(mode);p.input.review=true;p.input.imageBase64="data:image/png;base64,YQ==";p.input.originalImageBase64="data:image/png;base64,Yg==";
  p.transcript={text:"synthetic q",facts:[],uncertainties:[],missingInformation:[]};p.geometryChecked=true;
  const before=structuredClone(p);replies(discussed);const result=await run(p);
  expect(result).toMatchObject({state:"answered",discussion:discussed.text});
  expect(p.result).toEqual(before.result);expect(p.input).toEqual(before.input);expect(p.transcript).toEqual(before.transcript);expect(p.geometryChecked).toBe(true);
  expect(chain).toHaveBeenCalledTimes(1);expect(chain.mock.calls[0][4].stage).toBe("solve");
 });
 it.each(["auto","update"] as const)("updates the method despite an identical final answer in %s",async mode=>{
  const p=payload(mode);replies(solved);const r=await run(p);expect(r.state).toBe("answered");expect(r.discussion).toBeUndefined();expect(p.result).toEqual(solved.result);expect(p.messages[0].text).toContain("old method");expect(chain).toHaveBeenCalledTimes(1);
 });
 it("enforces explain mode even if a legacy model returns a full solved payload",async()=>{
  const p=payload("explain");p.input.review=true;replies(solved);const r=await run(p);
  expect(r.discussion).toContain(solved.result.analysis);expect(r.discussion).toContain(solved.result.answerText);expect(p.result).toEqual(original);expect(chain).toHaveBeenCalledTimes(1);
 });
 it.each(["initial","update"])("rejects discussion for %s instead of guessing a result or redispatching",async kind=>{
  const p=payload("update");if(kind==="initial"){delete p.result;delete p.followUpMode;p.messages=[];}replies(discussed);
  await expect(run(p)).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",fallback:false});expect(chain).toHaveBeenCalledTimes(1);expect(p.result).toEqual(kind==="initial"?undefined:original);
 });
 it("still performs the opted-in independent review for an updated solution",async()=>{
  const p=payload("update");p.input.review=true;replies(solved,solved);await run(p);expect(chain.mock.calls.map(c=>c[4].stage)).toEqual(["solve","review"]);expect(p.reviewDone).toBe(true);
 });
 it("does not treat a discussion from the reviewer as a new solved result",async()=>{
  const p=payload("auto");p.input.review=true;replies(solved,discussed);await expect(run(p)).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",fallback:false});expect(chain).toHaveBeenCalledTimes(2);
 });
 it("retains mixed history and the current round mode in resumed context",()=>{
  const p=payload("explain");p.messages.push({id:"d2",kind:"discussion",text:"detail only",round:2,at:new Date(2).toISOString()});
  const c=JSON.parse(dialogueContext(p));expect(c.followUp).toEqual({mode:"explain",hasCurrentSolution:true});expect(c.messages.at(-1)).toMatchObject({kind:"discussion",text:"detail only"});expect(c.messages[0].text).toContain("old method");
 });
 it("preserves the full context limit instead of silently dropping a discussion",()=>{
  const p=payload();p.messages.push({id:"large",kind:"discussion",text:"x".repeat(200001),round:3,at:""});expect(()=>dialogueContext(p)).toThrow("AI_CONTEXT_LIMIT");
 });
 it("allows bounded missing-information follow-ups without replacing the original",async()=>{
  const p=payload("explain");replies({status:"needs_user",reason:"user_choice",questions:["Which step?"]});const r=await run(p);expect(r.state).toBe("awaiting_user");expect(p.followUpMode).toBe("explain");expect(p.result).toEqual(original);
 });
 it("states the mode contract without weakening JSON or evidence rules",()=>{
  expect(solvePrompt(undefined,false,"zh","auto")).toContain('"status":"discussion"');
  expect(solvePrompt(undefined,false,"zh","explain")).toContain("仅解释");
  expect(solvePrompt(undefined,false,"zh","update")).toContain("更新题解");
  expect(solvePrompt(undefined,true,"zh","auto")).toContain("独立复核");
 });
});


it("does not mistake an initial review checkpoint for a completed answer",async()=>{
 const p=payload();p.messages=[];replies(discussed);await expect(run(p)).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",fallback:false});expect(chain).toHaveBeenCalledTimes(1);
 expect(JSON.parse(dialogueContext(p)).followUp.hasCurrentSolution).toBe(false);
});
it("retains update semantics when auto selected a new solution but its review was interrupted",async()=>{
 const p=payload("auto");p.input.review=true;
 chain.mockImplementationOnce(async(_p,_t,_i,parse)=>parse(JSON.stringify(solved))).mockRejectedValueOnce(new Error("AI_ACCEPTANCE_UNKNOWN"));
 await expect(run(p)).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");expect(p.followUpMode).toBe("update");
 replies(discussed);await expect(run(p)).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",fallback:false});expect(chain).toHaveBeenCalledTimes(3);
});


it("keeps an explanatory reread separate from the adopted solution evidence",async()=>{
 const p=payload("explain");p.input.imageBase64="data:image/png;base64,YQ==";
 p.transcript={text:"adopted source",facts:[],uncertainties:[],missingInformation:[]};
 const before=structuredClone(p);const reread={...p.transcript,text:"supplement for this question"};
 replies({status:"needs_visual_check",questions:["Which label?"]},reread,discussed);
 const r=await run(p);expect(r.discussion).toBe(discussed.text);expect(p.transcript).toEqual(before.transcript);expect(p.result).toEqual(before.result);expect(p.input).toEqual(before.input);expect(p.rereads).toBe(1);
 expect(JSON.parse(chain.mock.calls[2][1]).transcription).toEqual(reread);expect(chain).toHaveBeenCalledTimes(3);
});
it("preserves adopted evidence at every checkpoint when a follow-up reread is interrupted",async()=>{
 const p=payload("auto");p.input.imageBase64="data:image/png;base64,YQ==";
 p.transcript={text:"adopted source",facts:[],uncertainties:[],missingInformation:[]};const before=structuredClone(p.transcript);
 const reread={...p.transcript,text:"supplement for this question"};const snapshots:DialoguePayload[]=[];
 chain.mockImplementationOnce(async(_p,_t,_i,parse)=>parse(JSON.stringify({status:"needs_visual_check",questions:["Which label?"]})))
 .mockImplementationOnce(async(_p,_t,_i,parse)=>parse(JSON.stringify(reread))).mockRejectedValueOnce(new Error("AI_ACCEPTANCE_UNKNOWN"));
 await expect(aiRun.run({signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:6},()=>advanceDialogue(p,async()=>{snapshots.push(structuredClone(p));}))).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");
 expect(snapshots.every(s=>JSON.stringify(s.transcript)===JSON.stringify(before))).toBe(true);expect(p.transcript).toEqual(before);
 replies(discussed);await run(p);expect(JSON.parse(chain.mock.calls[3][1]).transcription).toEqual(reread);expect(p.transcript).toEqual(before);expect(p.result).toEqual(original);expect(p.rereads).toBe(1);expect(chain).toHaveBeenCalledTimes(4);
});
it("adopts reread evidence only when auto actually updates the solution",async()=>{
 const p=payload("auto");p.input.imageBase64="data:image/png;base64,YQ==";p.transcript={text:"old source",facts:[],uncertainties:[],missingInformation:[]};
 const reread={...p.transcript,text:"new confirmed source"};replies({status:"needs_visual_check",questions:["Which label?"]},reread,{status:"solved",result:{...solved.result,questionText:""}});
 const r=await run(p);expect(r.discussion).toBeUndefined();expect(p.transcript).toEqual(reread);expect(p.result?.questionText).toContain(reread.text);expect(p.followUpMode).toBe("update");expect(chain).toHaveBeenCalledTimes(3);
});


it("uses the reviewer's reread for an automatic replacement instead of leaving it as discussion evidence",async()=>{
 const p=payload("auto");p.input.review=true;p.input.imageBase64="data:image/png;base64,YQ==";p.transcript={text:"old source",facts:[],uncertainties:[],missingInformation:[]};
 const reread={...p.transcript,text:"review verified source"};replies(solved,{status:"needs_visual_check",questions:["Check this label"]},reread,{status:"solved",result:{...solved.result,questionText:""}});
 await run(p);expect(p.reviewDone).toBe(true);expect(p.transcript).toEqual(reread);expect(p.followUpTranscript).toBeUndefined();expect(p.result?.questionText).toContain(reread.text);expect(chain).toHaveBeenCalledTimes(4);
});
