// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseJSON, parseTranscript, TranscriptSchema } from "@/lib/ai-dialogue/protocol";
const plain = {text:"synthetic $x$",facts:[],uncertainties:[],missingInformation:[]};
const region = {x:0.1,y:0.1,width:0.5,height:0.5};
const angle = {label:"1",vertex:"E",arms:["A","B"],region};
const geometry = {regions:[region],angles:[angle]};
describe("bounded AI JSON compatibility without changing geometric evidence",()=>{
 it("accepts a closed leading thinking block followed by fenced JSON",()=>{
  expect(parseJSON(`<think>synthetic discarded reasoning</think>\n\`\`\`json\n${JSON.stringify(plain)}\n\`\`\``,TranscriptSchema)).toEqual(plain);
 });
 it("does not strip thinking tags inside actual question strings",()=>{
  const value={...plain,text:"literal <think>content</think>"};
  expect(parseJSON(JSON.stringify(value),TranscriptSchema)).toEqual(value);
 });
 it("does not extract a JSON guess from an unclosed thinking block",()=>{
  expect(()=>parseJSON(`<think>${JSON.stringify(plain)}`,TranscriptSchema)).toThrow(expect.objectContaining({diagnostic:"JSON_INVALID"}));
 });
 it("keeps strict stored schema, but ignores unusable optional AI crop coordinates",()=>{
  const input={...plain,geometry:{regions:[{...region,x:90}],angles:[{...angle,region:{...region,width:3}}]}};
  expect(TranscriptSchema.safeParse(input).success).toBe(false);
  const result=parseTranscript(JSON.stringify(input));
  expect(result.geometry).toEqual({regions:[],angles:[{label:"1",vertex:"E",arms:["A","B"]}]});
  expect(TranscriptSchema.safeParse(result).success).toBe(true);
 });
 it("keeps valid crops and accepts omitted optional regions without inventing points",()=>{
  expect(parseTranscript(JSON.stringify({...plain,geometry})).geometry).toEqual(geometry);
  expect(parseTranscript(JSON.stringify({...plain,geometry:{angles:[angle]}})).geometry).toEqual({regions:[],angles:[angle]});
 });
 it.each([
  {...geometry,angles:[{...angle,arms:["E","B"]}]},
  {...geometry,angles:[angle,angle]},
  {...geometry,angles:[{...angle,vertex:"?"}]},
  {...geometry,angles:[{label:"1"}]},
 ])("never repairs or silently drops invalid angle evidence %#",g=>{
  expect(()=>parseTranscript(JSON.stringify({...plain,geometry:g}))).toThrow(expect.objectContaining({diagnostic:"GEOMETRY_INVALID"}));
 });
 it("classifies JSON syntax separately from required-field validation",()=>{
  expect(()=>parseJSON("synthetic invalid JSON",TranscriptSchema)).toThrow(expect.objectContaining({code:"AI_RESPONSE_ERROR",fallback:true,diagnostic:"JSON_INVALID"}));
  expect(()=>parseJSON('{"text":"synthetic"}',TranscriptSchema)).toThrow(expect.objectContaining({diagnostic:"JSON_SCHEMA_INVALID"}));
 });
 it("does not fix LaTeX by silently changing backslash semantics",()=>{
  expect(()=>parseJSON(String.raw`{"text":"\angle AEB"}`,TranscriptSchema)).toThrow(expect.objectContaining({diagnostic:"JSON_INVALID"}));
 });
 it("does not return schema issue details or the original response in errors",()=>{
  try {parseJSON(JSON.stringify({...plain,facts:[{detail:"PRIVATE-FIXTURE",source:"PRIVATE-SOURCE"}]}),TranscriptSchema);throw Error("expected");}
  catch(error){expect(JSON.stringify(error)).not.toContain("PRIVATE");expect(String(error)).toBe("Error: AI_RESPONSE_ERROR");}
 });
});
