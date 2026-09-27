// @vitest-environment node
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const m=vi.hoisted(()=>({token:vi.fn(),user:vi.fn()}));
vi.mock("next-auth/jwt",()=>({getToken:m.token}));
vi.mock("@/lib/prisma",()=>({prisma:{user:{findUnique:m.user}}}));
import {middleware} from "@/middleware";
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("NEXTAUTH_URL","https://site.example.invalid");m.token.mockResolvedValue({id:"member",role:"admin",sessionVersion:1});m.user.mockResolvedValue({id:"member",role:"user",isActive:true,expiresAt:null,sessionVersion:1,mustChangePassword:false});});
afterEach(()=>vi.unstubAllEnvs());
const req=(path:string)=>new NextRequest("https://site.example.invalid"+path);
it.each(["/api/notebooks","/api/settings","/api/ai/jobs","/api/openclaw/batch-upload","/api/admin/users"])('rejects deleted or expired users across API path %s',async path=>{m.user.mockResolvedValue(null);expect((await middleware(req(path)))?.status).toBe(401);m.user.mockResolvedValue({id:"member",isActive:true,expiresAt:new Date(0),sessionVersion:1});expect((await middleware(req(path)))?.status).toBe(401);});
it("uses current role rather than stale token role",async()=>{expect((await middleware(req("/api/admin/users")))?.status).toBe(403);});
it("revokes old version, but does not loop from the login page",async()=>{m.user.mockResolvedValue({id:"member",isActive:true,expiresAt:null,sessionVersion:2});expect((await middleware(req("/api/user")))?.status).toBe(401);expect(await middleware(req("/login"))).toBeNull();});
it("only permits password change and session/signout for a forced-change user",async()=>{m.user.mockResolvedValue({id:"member",role:"admin",isActive:true,sessionVersion:1,mustChangePassword:true});expect((await middleware(req("/api/notebooks")))?.status).toBe(403);expect((await middleware(req("/notebooks")))?.headers.get("location")).toBe("https://site.example.invalid/change-password");expect(await middleware(req("/change-password"))).toBeNull();expect(await middleware(req("/api/user/password"))).toBeNull();expect((await middleware(req("/api/auth/signout")))?.status).toBe(200);});
it.each(["/api/registration/status","/api/register/status","/api/register","/api/ai/config/template"])('keeps only designated unauthenticated endpoint %s public',async path=>{m.token.mockResolvedValue(null);expect((await middleware(req(path)))?.status).toBe(200);expect(m.user).not.toHaveBeenCalled();});
it.each(["/api/register/admin","/register/not-public","/api/registration/status-extra","/login/extra"])('does not allow prefix bypass at %s',async path=>{m.token.mockResolvedValue(null);const r=await middleware(req(path));expect([401,307]).toContain(r?.status);});
it("fails closed if the live database lookup throws",async()=>{m.user.mockRejectedValue(new Error("private stack"));const r=await middleware(req("/api/user"));expect(r?.status).toBe(503);expect(await r?.text()).not.toContain("private stack");});

it("blocks cross-site writes across legacy protected APIs",async()=>{for(const headers of [new Headers({origin:"https://evil.example.invalid"}),new Headers({"sec-fetch-site":"cross-site"})]){const r=await middleware(new NextRequest("https://site.example.invalid/api/notebooks",{method:"POST",headers}));expect(r?.status).toBe(403);}});
it("allows same-origin protected writes",async()=>{expect(await middleware(new NextRequest("https://site.example.invalid/api/notebooks",{method:"POST",headers:{origin:"https://site.example.invalid","sec-fetch-site":"same-origin"}}))).toBeNull();});
