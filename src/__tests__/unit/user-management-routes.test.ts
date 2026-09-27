// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({admin:vi.fn(),list:vi.fn(),create:vi.fn(),register:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{user:{findMany:m.list}}}));
vi.mock("@/lib/ai-access",async importOriginal=>({...await importOriginal<typeof import("@/lib/ai-access")>(),requireAdmin:m.admin}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("@/lib/user-management/rate-limit",()=>({consumeAuthLimit:async()=>true,requestIp:()=>undefined}));
vi.mock("@/lib/user-management/users",()=>({createManagedUser:m.create}));
vi.mock("@/lib/user-management/registration",()=>({registerUser:m.register}));
import {GET,POST} from "@/app/api/admin/users/route";
import {POST as register} from "@/app/api/register/route";
import {AIRequestError} from "@/lib/ai-access";
beforeEach(()=>{vi.resetAllMocks();m.admin.mockResolvedValue({id:"admin",role:"admin"});m.list.mockResolvedValue([{id:"safe"}]);m.create.mockResolvedValue({user:{id:"new"}});m.register.mockResolvedValue({id:"new"});});
const request=(body:unknown={},headers={})=>new Request("http://localhost/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
describe("user HTTP security",()=>{
 it("uses the current admin guard on reads and writes before touching users",async()=>{m.admin.mockRejectedValue(new AIRequestError(403,"Administrator access required"));expect((await GET(new Request("http://localhost/api/admin/users"))).status).toBe(403);expect((await POST(request())).status).toBe(403);expect(m.list).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});
 it("never lists password hashes or vault/session internals",async()=>{const r=await GET(new Request("http://localhost/api/admin/users"));expect(r.headers.get("cache-control")).toBe("no-store");expect(m.list.mock.calls[0][0].select.password).toBeUndefined();expect(m.list.mock.calls[0][0].select.sessionVersion).toBeUndefined();});
 it("denies cross-origin writes before invoking the service",async()=>{const r=await POST(request({}, {Origin:"https://evil.invalid"}));expect(r.status).toBe(403);expect(m.create).not.toHaveBeenCalled();});
 it("does not return internal exceptions or registration identity details",async()=>{m.register.mockRejectedValue(new Error("private database dump"));const r=await register(request());expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain("private database");});
});
