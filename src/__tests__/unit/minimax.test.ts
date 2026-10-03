// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import sharp from "sharp";
const safe=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/ai-url",()=>({withSafeAIResponse:safe,AIUrlError:class extends Error{}}));
import {buildMiniMaxRequest,decodeMiniMaxImage,sendMiniMaxImage} from "@/lib/ai-drawing/minimax";
import {miniMaxEndpoint} from "@/lib/ai-drawing/illustration-schema";
const provider={id:"p",name:"MiniMax",protocol:"chat" as const,baseUrl:"https://api.minimax.cn/v1",apiKey:"synthetic-test-key",enabled:true};
const input={prompt:"合成测试：蓝色方块",ratio:"1:1" as const,model:"image-01" as const};
beforeEach(()=>vi.clearAllMocks());
describe("MiniMax dedicated image protocol",()=>{
 it.each(["api.minimaxi.com","api.minimax.cn","api.minimax.io"].flatMap(host=>["","/","/v1","/v1/"].map(suffix=>({baseUrl:`https://${host}${suffix}`,endpoint:`https://${host}/v1/image_generation`}))))("accepts official base URL $baseUrl without changing the host",({baseUrl,endpoint})=>{
  expect(miniMaxEndpoint(baseUrl)).toBe(endpoint);
  const r=buildMiniMaxRequest({...provider,baseUrl},input);
  expect(r.url).toBe(endpoint);expect(r.headers.Authorization).toBe("Bearer synthetic-test-key");
 });
 it.each(["https://api.minimaxi.com.evil.example/v1","https://api.minimaxi.com@evil.example/v1","https://evil.example@api.minimaxi.com/v1","https://api.minimaxi.com:8443/v1","http://api.minimaxi.com/v1","https://api.minimaxi.com/v1?key=bad","https://api.minimaxi.com/v1#fragment","https://api.minimaxi.com/anthropic","https://api.minimaxi.com/v1/image_generation","https://api.minimaxi.com/v1/chat/completions"])("rejects spoofed or non-base MiniMax URLs %s",url=>expect(miniMaxEndpoint(url)).toBeNull());
 it("uses the same saved host/key, base64 and one image without prompt rewriting",()=>{
  const r=buildMiniMaxRequest(provider,input);
  expect(r.url).toBe("https://api.minimax.cn/v1/image_generation");
  expect(r.headers.Authorization).toBe("Bearer synthetic-test-key");
  expect(r.body).toEqual({model:"image-01",prompt:input.prompt,aspect_ratio:"1:1",n:1,response_format:"base64",prompt_optimizer:false,aigc_watermark:true});
 });
 it.each(["https://other.example/v1","http://api.minimax.cn","https://api.minimax.cn/anthropic","https://api.minimax.cn/v1?key=bad","https://api.minimax.cn.evil.example"])("rejects unsafe or ambiguous endpoint %s",url=>expect(()=>buildMiniMaxRequest({...provider,baseUrl:url},input)).toThrow("AI_ILLUSTRATION_ENDPOINT"));
 it("validates model and prompt at the server boundary",()=>{
  expect(()=>buildMiniMaxRequest(provider,{...input,prompt:" ".repeat(3)})).toThrow();
  expect(()=>buildMiniMaxRequest(provider,{...input,prompt:"x".repeat(1501)})).toThrow();
  expect(()=>buildMiniMaxRequest(provider,{...input,model:"chat-model" as "image-01"})).toThrow();
 });
 it("normalizes valid image content into bounded PNG",async()=>{
  const jpeg=await sharp({create:{width:2,height:2,channels:3,background:"blue"}}).jpeg().toBuffer();
  const r=await decodeMiniMaxImage({base_resp:{status_code:0},data:{image_base64:[jpeg.toString("base64")]}});
  expect(r).toMatch(/^data:image\/png;base64,/);
  expect((await sharp(Buffer.from(r.split(",")[1],"base64")).metadata()).format).toBe("png");
 });
 it.each([{base_resp:{status_code:1004,status_msg:"secret must not escape"},data:{image_base64:["YQ=="]}},{data:{image_base64:["YQ=="]}}])("requires explicit business success",async raw=>{await expect(decodeMiniMaxImage(raw)).rejects.toThrow("AI_ILLUSTRATION_UPSTREAM");});
 it.each([{image_urls:["https://evil.example/private"]},{image_base64:["YQ=="]},{image_base64:["<svg onload='bad'/>"]},{image_base64:["A".repeat(14*1024*1024+1)]}])("rejects remote-only, corrupt or oversized images",async data=>{await expect(decodeMiniMaxImage({base_resp:{status_code:0},data})).rejects.toThrow();expect(safe).not.toHaveBeenCalled();});
 it("sends once and marks transport failure ambiguous, without retry or fallback",async()=>{
  safe.mockRejectedValue(Error("sensitive upstream body"));
  await expect(sendMiniMaxImage(provider,input,new AbortController().signal)).rejects.toThrow("AI_ACCEPTANCE_UNKNOWN");expect(safe).toHaveBeenCalledTimes(1);
 });
 it("reads HTTP errors without exposing response bodies",async()=>{
  safe.mockImplementation(async(_u,_i,consume)=>consume(new Response("secret",{status:401})));
  await expect(sendMiniMaxImage(provider,input,new AbortController().signal)).rejects.toThrow("AI_AUTH_ERROR");expect(safe).toHaveBeenCalledTimes(1);
 });
});
