// @vitest-environment node
import { describe,it,expect } from "vitest";
import { buildRequest,decodeResponse } from "@/lib/ai/transport";
const p={id:"p",name:"Fixture",protocol:"chat" as const,baseUrl:"https://example.invalid/v1",apiKey:"synthetic",enabled:true};
const m={id:"m",providerId:"p",name:"Fixture",model:"synthetic",enabled:true,capabilities:["text","vision"] as ("text"|"vision")[]};
const frame=(delta:object,finish_reason:string|null=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`;
const sse=(text:string)=>new Response(text,{headers:{"content-type":"text/event-stream"}});
describe("bounded streaming transcription without re-dispatch",()=>{
 it("streams recognition without changing solver defaults or inventing provider thinking parameters",()=>{
  const r=buildRequest(p,m,"prompt","text","data:image/png;base64,eA==",[],"transcription");
  expect(r.body.stream).toBe(true);expect(r.headers.Accept).toBe("text/event-stream");
  expect(r.body).not.toHaveProperty("thinking");expect(r.body).not.toHaveProperty("enable_thinking");
  expect(buildRequest(p,m,"prompt","text").body.stream).toBe(false);
 });
 it("collects final content but never reasoning content",async()=>{
  await expect(decodeResponse(sse(frame({reasoning_content:"PRIVATE-THOUGHT"})+frame({content:'{"text":'})+frame({content:'"synthetic"}'})+frame({},"stop")),"chat")).resolves.toBe('{"text":"synthetic"}');
 });
 it.each(["chat","azure"] as const)("requires an explicit successful terminal frame for %s",async protocol=>{
  await expect(decodeResponse(sse(frame({content:"partial"})+"data: [DONE]\n\n"),protocol)).rejects.toMatchObject({code:"AI_ACCEPTANCE_UNKNOWN",fallback:false,diagnostic:"STREAM_INCOMPLETE"});
 });
 it.each([["length","OUTPUT_TRUNCATED"],["content_filter","OUTPUT_FILTERED"],["tool_calls","ENVELOPE_INVALID"]])("does not trust %s output",async(reason,diagnostic)=>{
  await expect(decodeResponse(sse(frame({content:"looks complete"},reason)),"chat")).rejects.toMatchObject({code:"AI_RESPONSE_ERROR",diagnostic});
 });
 it("does not accept reasoning-only completion",async()=>{
  await expect(decodeResponse(sse(frame({reasoning_content:"PRIVATE"})+frame({},"stop")),"chat")).rejects.toMatchObject({diagnostic:"REASONING_ONLY"});
 });
 it("handles a server that replies with a normal JSON envelope even when asked to stream",async()=>{
  await expect(decodeResponse(Response.json({choices:[{message:{content:"ok"},finish_reason:"stop"}]}),"chat")).resolves.toBe("ok");
 });
 it("cancels the reader as soon as terminal content is received, without waiting for a hanging socket",async()=>{
  let cancelled=false; const bytes=new TextEncoder().encode(frame({content:"中文"},"stop"));
  const stream=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));},cancel(){cancelled=true;}});
  await expect(decodeResponse(new Response(stream,{headers:{"content-type":"text/event-stream"}}),"chat")).resolves.toBe("中文");expect(cancelled).toBe(true);
 });
});
