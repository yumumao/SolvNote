// @vitest-environment node
import { describe,it,expect } from "vitest";
import { RECOGNIZE_PROMPT,parseTranscript,TranscriptSchema } from "@/lib/ai-dialogue/protocol";
describe("recognition contract matches its own prompt",()=>{
 it("uses a valid complete JSON example, not alternatives masquerading as values",()=>{
  const example=RECOGNIZE_PROMPT.split("\n").find(l=>l.startsWith('{"text":'))!;
  expect(example).toBeTruthy();
  expect(TranscriptSchema.safeParse(JSON.parse(example.replace(/[。；]$/, ""))).success).toBe(true);
  expect(RECOGNIZE_PROMPT).not.toContain('"source":"text或image"');
 });
 it.each([{text:"synthetic"},{text:"synthetic",facts:null,uncertainties:null,missingInformation:null}])("normalizes absent auxiliary lists without discarding the transcription",value=>{
  expect(parseTranscript(JSON.stringify(value))).toEqual({text:"synthetic",facts:[],uncertainties:[],missingInformation:[]});
 });
 it("retains factual text without inventing its missing source",()=>{
  expect(parseTranscript(JSON.stringify({text:"synthetic",facts:["given condition",{detail:"another condition"}],uncertainties:"unclear ray",missingInformation:""}))).toEqual({text:"synthetic",facts:[{detail:"given condition"},{detail:"another condition"}],uncertainties:["unclear ray"],missingInformation:[]});
 });
 it("does not mistake the old ambiguous source example for verified image evidence",()=>{
  expect(parseTranscript(JSON.stringify({text:"synthetic",facts:[{detail:"given",source:"text或image"}]})).facts).toEqual([{detail:"given"}]);
 });
 it("accepts null optional geometry but never fabricates required text or semantic angles",()=>{
  expect(parseTranscript('{"text":"synthetic","geometry":null}').geometry).toBeUndefined();
  for(const value of [{text:" "},{text:null},{text:3},{text:"x",facts:[{source:"image"}]},{text:"x",geometry:{regions:[],angles:[{label:"1",vertex:"E",arms:["E","B"]}]}}]) expect(()=>parseTranscript(JSON.stringify(value))).toThrow();
 });
 it("still rejects unknown source values and excessive metadata rather than silently deleting them",()=>{
  expect(()=>parseTranscript(JSON.stringify({text:"x",facts:[{detail:"given",source:"PRIVATE-UNKNOWN"}]}))).toThrow();
  expect(()=>parseTranscript(JSON.stringify({text:"x",uncertainties:Array(9).fill("x")}))).toThrow();
 });
});
