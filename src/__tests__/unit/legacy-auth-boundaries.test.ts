// @vitest-environment node
import {beforeEach, it, expect, vi} from "vitest";
const m=vi.hoisted(()=>({require:vi.fn(),origin:vi.fn(),find:vi.fn()}));
vi.mock("@/lib/ai-access",async()=>{const real=await vi.importActual<typeof import("@/lib/ai-access")>("@/lib/ai-access");return {...real,requireUser:m.require,assertSameOrigin:m.origin};});
vi.mock("@/lib/prisma",()=>({prisma:{user:{findUnique:m.find,findFirst:m.find}}}));
import {POST} from "@/app/api/openclaw/batch-upload/route";
import {AIRequestError} from "@/lib/ai-access";
import {config} from "@/middleware";
beforeEach(()=>{vi.resetAllMocks();m.require.mockResolvedValue({id:"current",role:"user"});m.find.mockResolvedValue({id:"current",email:"current@example.invalid"});});
const request=(body:unknown)=>new Request("https://site.example.invalid/api/openclaw/batch-upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
it("does not allow legacy API credentials to bypass live authentication",async()=>{m.require.mockRejectedValue(new AIRequestError(401,"Authentication required"));const r=await POST(request({username:"legacy",password:"not-a-real-password",images:[]}));expect(r.status).toBe(401);expect(m.find).not.toHaveBeenCalled();});
it("does not let a signed-in caller select another account",async()=>{const r=await POST(request({userEmail:"other@example.invalid",images:[]}));expect(r.status).toBe(403);});
it("denies cross-site legacy writes before reading account data",async()=>{m.origin.mockImplementation(()=>{throw new AIRequestError(403,"Cross-origin request denied")});const r=await POST(request({images:[]}));expect(r.status).toBe(403);expect(m.find).not.toHaveBeenCalled();});
it("does not exclude optimized private images from the live account boundary",()=>{expect(config.matcher.join("")).not.toContain("_next/image");});
