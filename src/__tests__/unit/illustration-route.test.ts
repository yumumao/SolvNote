// @vitest-environment node
import {describe,it,expect,vi,beforeEach} from "vitest";
const m=vi.hoisted(()=>({admin:true,read:vi.fn(),save:vi.fn()}));
vi.mock("@/lib/ai-access",async original=>{const real=await original<typeof import("@/lib/ai-access")>();return {...real,requireAdmin:async()=>{if(!m.admin)throw new real.AIRequestError(403,"FORBIDDEN");return {id:"admin",role:"admin",sessionVersion:0}}}});
vi.mock("@/lib/ai-drawing/illustration-settings",()=>({getIllustrationSettings:m.read,saveIllustrationSettings:m.save}));
import {GET,POST} from "@/app/api/ai/illustration-settings/route";
beforeEach(()=>{vi.clearAllMocks();m.admin=true;m.read.mockResolvedValue({enabled:false});m.save.mockResolvedValue({enabled:false})});
const req=(body={},origin="http://localhost:3000")=>new Request("http://localhost:3000/api/ai/illustration-settings",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
describe("media settings route",()=>{
 it("requires administrator for reads and writes",async()=>{m.admin=false;expect((await GET(req())).status).toBe(403);expect((await POST(req())).status).toBe(403);expect(m.read).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()});
 it("rejects cross-site mutation",async()=>{expect((await POST(req({},"https://evil.invalid"))).status).toBe(403);expect(m.save).not.toHaveBeenCalled()});
 it("returns no-store settings and bounds body",async()=>{expect((await GET(req())).headers.get("cache-control")).toBe("no-store");expect((await POST(req({x:"a".repeat(20000)}))).status).toBe(413);expect(m.save).not.toHaveBeenCalled()});
});
