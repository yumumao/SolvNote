// @vitest-environment node
// HTTP contract tests; real transactions, hashing, invitation consumption and expiry
// are covered by user-lifecycle-security.test.ts against disposable SQLite.
import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({register:vi.fn(),status:vi.fn()}));
vi.mock("@/lib/auth",()=>({authOptions:{}}));
vi.mock("@/lib/user-management/registration",()=>({registerUser:m.register}));
vi.mock("@/lib/user-management/registration-settings",()=>({publicRegistrationStatus:m.status}));
import {POST} from "@/app/api/register/route";
import {GET} from "@/app/api/registration/status/route";
import {GET as OLD_STATUS} from "@/app/api/register/status/route";
import {UserManagementError as E} from "@/lib/user-management/errors";
import {z} from "zod";
const request=(body:unknown={},headers={})=>new Request("https://solvnote.example.invalid/api/register",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();m.status.mockResolvedValue({enabled:false,inviteRequired:false,inviteCode:null,turnstileSiteKey:"public",turnstileConfigured:true});m.register.mockResolvedValue({id:"synthetic",name:"Member"});});
it("forwards only the bounded body to the transactional registration service",async()=>{const body={email:"member@example.invalid",password:"synthetic-test-only",turnstileToken:"test-only"};const r=await POST(request(body));expect(r.status).toBe(201);expect(r.headers.get("cache-control")).toBe("no-store");expect(m.register).toHaveBeenCalledWith(body,{remoteIp:undefined});expect(await r.json()).toEqual({id:"synthetic",name:"Member"});});
it.each([["REGISTRATION_DISABLED",403],["VERIFICATION_FAILED",403],["TOO_MANY_ATTEMPTS",429],["REGISTRATION_REJECTED",400]])("returns only fixed public service error %s",async(code,status)=>{m.register.mockRejectedValue(new E(code as string,status as number));const r=await POST(request());expect(r.status).toBe(status);expect(await r.json()).toEqual({error:code});});
it("does not reveal validation values",async()=>{m.register.mockImplementation(()=>z.object({safe:z.string()}).parse({}));const r=await POST(request());expect(r.status).toBe(400);expect(await r.json()).toEqual({error:"INVALID_INPUT"});});
it.each([{"Content-Type":"text/plain"},{Origin:"https://evil.invalid"}])("rejects unsafe browser submissions before any transaction",async headers=>{const r=await POST(request({},headers));expect([403,415]).toContain(r.status);expect(m.register).not.toHaveBeenCalled();});
it("rejects oversized payloads",async()=>{expect((await POST(request({name:"x".repeat(17000)}))).status).toBe(413);expect(m.register).not.toHaveBeenCalled();});
it("canonical and compatibility status endpoints use the same closed-default policy",async()=>{const a=await GET(),b=await OLD_STATUS();expect((await a.json()).enabled).toBe(false);expect((await b.json()).allowRegistration).toBe(false);expect(a.headers.get("cache-control")).toBe("no-store");});
