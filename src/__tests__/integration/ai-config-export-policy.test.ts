// @vitest-environment node
// Real routes, schema, crypto and preview tokens; isolated in-memory store/key only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PortableConfig } from "@/lib/ai-config/schema";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), load: vi.fn(), save: vi.fn(), key: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai-access", async original => ({...await original<typeof import("@/lib/ai-access")>(), requireAdmin:mocks.admin}));
vi.mock("@/lib/ai-config/store", () => ({loadAIConfig:mocks.load, saveAIConfig:mocks.save}));
vi.mock("@/lib/ai-config/vault", () => ({masterKey:mocks.key}));
import { POST as IMPORT } from "@/app/api/ai/config/import/route";
import { POST as EXPORT } from "@/app/api/ai/config/export/route";
import { sealExport } from "@/lib/ai-config/crypto";
const origin="https://settings.example.invalid";
const loadTemplate=()=>JSON.parse(readFileSync(path.join(process.cwd(),"docs/templates/solvnote-ai-config.template.json"),"utf8")) as PortableConfig;
const request=(endpoint:string, body:unknown)=>new Request(`${origin}/api/ai/config/${endpoint}`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
    vi.stubEnv("SOLVNOTE_ENABLE_AI_CONFIG_EXPORT", undefined);vi.stubEnv("NEXTAUTH_URL",origin);
    vi.stubGlobal("fetch",vi.fn(()=>{throw Error("network prohibited");}));
    mocks.admin.mockReset().mockResolvedValue({id:"synthetic-admin",role:"admin",sessionVersion:4});
    mocks.load.mockReset().mockResolvedValue({config:{version:1,providers:[],models:[],chains:{text:[],vision:[]}},revision:7});
    mocks.save.mockReset().mockResolvedValue(8); mocks.key.mockReset().mockReturnValue(Buffer.alloc(32,1));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("disables export without touching config/key but allows template preview and confirmed import",async()=>{
    const denied=await EXPORT(request("export",{password:"synthetic-passphrase",revision:7,exportEnabled:true}));
    expect(denied.status).toBe(403);expect(await denied.json()).toEqual({message:"AI_CONFIG_EXPORT_DISABLED"});
    expect(mocks.load).not.toHaveBeenCalled();expect(mocks.key).not.toHaveBeenCalled();
    const config=loadTemplate();config.providers[0].apiKey="synthetic-local-fill-only";
    const body={action:"preview",mode:"replace",envelope:config,password:""};
    const response=await IMPORT(request("import",body));expect(response.status).toBe(200);
    const preview=await response.json();expect(preview.config.providers[0].apiKey).toBe("********");
    expect(JSON.stringify(preview)).not.toContain("synthetic-local-fill-only");expect(mocks.save).not.toHaveBeenCalled();
    const confirmed=await IMPORT(request("import",{...body,action:"apply",revision:preview.revision,expires:preview.expires,previewToken:preview.previewToken}));
    expect(confirmed.status).toBe(200);expect(mocks.save).toHaveBeenCalledExactlyOnceWith(config,7,{id:"synthetic-admin",role:"admin",sessionVersion:4});
    expect(await confirmed.text()).not.toContain("synthetic-local-fill-only");expect(fetch).not.toHaveBeenCalled();
});
it("rejects invalid templates before storage/key access and tampered previews before writes",async()=>{
    const config=loadTemplate();config.models[0].providerId="missing";
    const invalid=await IMPORT(request("import",{action:"preview",mode:"replace",envelope:config,password:""}));
    expect(invalid.status).toBe(400);expect(mocks.load).not.toHaveBeenCalled();expect(mocks.key).not.toHaveBeenCalled();
    const body={action:"preview",mode:"replace",envelope:loadTemplate(),password:""};
    const preview=await (await IMPORT(request("import",body))).json();
    body.envelope.providers[0].name="Changed after preview";
    const response=await IMPORT(request("import",{...body,action:"apply",revision:preview.revision,expires:preview.expires,previewToken:preview.previewToken}));
    expect(response.status).toBe(400);expect(await response.json()).toEqual({message:"IMPORT_PREVIEW_INVALID"});expect(mocks.save).not.toHaveBeenCalled();
});
it("retains encrypted import preview while exports are disabled",async()=>{
    const config=loadTemplate();const password="synthetic-passphrase";const envelope=await sealExport(config,password);
    const response=await IMPORT(request("import",{action:"preview",mode:"replace",envelope,password}));
    expect(response.status).toBe(200);expect(mocks.save).not.toHaveBeenCalled();
});
it.each([401,403,503])("keeps template import behind live authorization: %s",async status=>{
    mocks.admin.mockRejectedValue(Object.assign(Error("synthetic-private-error"),{status}));
    const response=await IMPORT(request("import",{action:"preview",mode:"replace",envelope:loadTemplate(),password:""}));
    expect(response.status).toBe(status);expect(mocks.load).not.toHaveBeenCalled();expect(mocks.key).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
