// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const wire=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/ai-url",()=>({AIUrlError:class extends Error{},withSafeAIResponse:wire}));
import { decodeResponse, sendAI } from "@/lib/ai/transport";
const p={id:"p",name:"Fixture",protocol:"chat" as const,baseUrl:"https://example.invalid/v1",apiKey:"fixture-only",enabled:true};
const m={id:"m",providerId:"p",name:"Fixture",model:"fixture",capabilities:["text","vision"] as ("text"|"vision")[],enabled:true};
beforeEach(()=>{wire.mockReset();});
describe("safe response diagnostics",()=>{
 it.each([
  [{choices:[{finish_reason:"length",message:{content:"partial answer"}}]},"OUTPUT_TRUNCATED"],
  [{choices:[{finish_reason:"stop",message:{content:"",reasoning_content:"PRIVATE-THOUGHT"}}]},"REASONING_ONLY"],
  [{choices:[{message:{content:""}}]},"RESPONSE_EMPTY"],
  [{choices:[{finish_reason:"content_filter",message:{content:""}}]},"OUTPUT_FILTERED"],
  [{error:{message:"PRIVATE-ERROR"}},"ENVELOPE_INVALID"],
  [null,"ENVELOPE_INVALID"],
 ])("classifies chat response shape %# without exposing provider details",async(payload,diagnostic)=>{
  await expect(decodeResponse(Response.json(payload),"chat")).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",fallback:true,diagnostic,message:"AI_RESPONSE_ERROR"});
 });
 it("classifies a non-JSON HTTP body without leaking it",async()=>{
  await expect(decodeResponse(new Response("PRIVATE-HTML"),"chat")).rejects.toMatchObject({diagnostic:"ENVELOPE_INVALID"});
 });
 it("never treats an incomplete Responses JSON envelope as a complete answer",async()=>{
  await expect(decodeResponse(Response.json({status:"incomplete",output_text:"partial"}),"responses")).rejects.toMatchObject({diagnostic:"OUTPUT_TRUNCATED"});
 });
 it("rejects Gemini max-token termination even if the text looks complete",async()=>{
  await expect(decodeResponse(Response.json({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:"partial"}]}}]}),"gemini")).rejects.toMatchObject({diagnostic:"OUTPUT_TRUNCATED"});
 });
 it("keeps normal replies compatible",async()=>{
  await expect(decodeResponse(Response.json({choices:[{finish_reason:"stop",message:{content:"ok"}}]}),"chat")).resolves.toBe("ok");
 });
 it("records timeout before response headers, but still prohibits automatic resend",async()=>{
  const controller=new AbortController();
  wire.mockImplementation(async()=>{controller.abort(new DOMException("fixture","TimeoutError"));throw Error("PRIVATE-NETWORK");});
  await expect(sendAI(p,m,"rule","text",undefined,controller.signal)).rejects.toMatchObject({code:"AI_ACCEPTANCE_UNKNOWN",fallback:false,diagnostic:"TIMEOUT_BEFORE_HEADERS"});
  expect(wire).toHaveBeenCalledTimes(1);
 });
 it("records timeout while reading a received response, without accepting fragments",async()=>{
  const controller=new AbortController();
  wire.mockImplementation(async(_url,_init,consume)=>consume(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"choices":'));},pull(c){controller.abort(new DOMException("fixture","TimeoutError"));c.error(Error("PRIVATE-READ"));}}))));
  await expect(sendAI(p,m,"rule","text",undefined,controller.signal)).rejects.toMatchObject({code:"AI_ACCEPTANCE_UNKNOWN",fallback:false,diagnostic:"TIMEOUT_READING_BODY"});
  expect(wire).toHaveBeenCalledTimes(1);
 });
 it("distinguishes body interruption from timeout",async()=>{
  const stream=new ReadableStream({start(c){c.error(Error("PRIVATE"));}});
  await expect(decodeResponse(new Response(stream),"chat")).rejects.toMatchObject({code:"AI_ACCEPTANCE_UNKNOWN",fallback:false,diagnostic:"NETWORK_READING_BODY"});
 });
});

it.each([
 ["responses",{status:"completed",output:[null]}],
 ["responses",{status:"completed",output:[{content:{bad:"PRIVATE"}}]}],
 ["gemini",{candidates:[{content:{parts:{bad:"PRIVATE"}}}]}],
 ["gemini",{candidates:[{content:{parts:[null]}}]}],
] as const)("does not leak nested envelope exceptions for %s",async(protocol,payload)=>{
 await expect(decodeResponse(Response.json(payload),protocol)).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",fallback:true,diagnostic:"ENVELOPE_INVALID"});
});
it("recognizes reasoning-only responses whose final content is whitespace",async()=>{
 await expect(decodeResponse(Response.json({choices:[{message:{content:"  ",reasoning_content:"PRIVATE"}}]}),"chat")).rejects.toMatchObject({diagnostic:"REASONING_ONLY"});
});
