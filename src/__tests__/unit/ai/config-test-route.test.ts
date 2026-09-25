// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({admin:vi.fn(),origin:vi.fn(),load:vi.fn(),send:vi.fn()}));
vi.mock("@/lib/ai-access",()=>({requireAdmin:m.admin,assertSameOrigin:m.origin}));
vi.mock("@/lib/ai-config/store",()=>({loadAIConfig:m.load}));
vi.mock("@/lib/ai/transport",async original=>({...await original<typeof import("@/lib/ai/transport")>(),sendAI:m.send}));
import {POST} from "@/app/api/ai/config/test/route";
import {AIError} from "@/lib/ai/transport";
const request=(body:unknown={modelId:"m",revision:2})=>new Request("https://example.invalid/api/ai/config/test",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();m.admin.mockResolvedValue({id:"admin"});m.load.mockResolvedValue({revision:2,config:{providers:[{id:"p",name:"fixture",baseUrl:"https://example.invalid/v1",protocol:"responses",apiKey:"synthetic-only",enabled:true}],models:[{id:"m",providerId:"p",model:"fixture-model",name:"fixture",capabilities:["text","vision"],enabled:true}]}});m.send.mockResolvedValue("OK");});
describe("saved-model connectivity",()=>{
 it("uses the saved secret and shared transport once; no user image and no capability mutation",async()=>{
  const res=await POST(request());expect(res.status).toBe(200);expect(await res.json()).toMatchObject({success:true});expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.send.mock.calls[0][0].apiKey).toBe("synthetic-only");expect(m.send.mock.calls[0][4]).toBeUndefined();
 });
 it("authenticates and checks same origin before reading config",async()=>{
  m.admin.mockRejectedValueOnce(Object.assign(new Error("private"),{status:403}));expect((await POST(request())).status).toBe(403);expect(m.load).not.toHaveBeenCalled();
  m.origin.mockImplementationOnce(()=>{throw Object.assign(new Error("private"),{status:403});});expect((await POST(request())).status).toBe(403);expect(m.send).not.toHaveBeenCalled();
 });
 it("rejects stale revision and user-supplied endpoints/keys",async()=>{
  expect((await POST(request({modelId:"m",revision:1}))).status).toBe(409);expect((await POST(request({modelId:"m",revision:2,baseUrl:"https://evil.invalid"}))).status).toBe(400);expect(m.send).not.toHaveBeenCalled();
 });
 it("does not retry or leak arbitrary upstream errors",async()=>{
  m.send.mockRejectedValueOnce(new Error("synthetic-only https://private.invalid"));const res=await POST(request());expect(JSON.stringify(await res.json())).not.toContain("private");expect(m.send).toHaveBeenCalledTimes(1);
 });
 it("preserves uncertain acceptance instead of telling the user to blindly retry",async()=>{
  m.send.mockRejectedValueOnce(new AIError("AI_ACCEPTANCE_UNKNOWN"));expect(await (await POST(request())).json()).toMatchObject({success:false,code:"AI_ACCEPTANCE_UNKNOWN"});expect(m.send).toHaveBeenCalledTimes(1);
 });
 it("blocks parallel tests without fallback",async()=>{
  let finish!:(s:string)=>void;m.send.mockImplementationOnce(()=>new Promise<string>(resolve=>finish=resolve));const pending=POST(request());await vi.waitFor(()=>expect(m.send).toHaveBeenCalledTimes(1));expect((await POST(request())).status).toBe(429);finish("OK");await pending;
 });
});
