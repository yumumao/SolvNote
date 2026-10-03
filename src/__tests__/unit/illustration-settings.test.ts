// @vitest-environment node
// These minimal Prisma transaction doubles intentionally implement only the exercised delegate methods.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({rows:new Map<string,any>(),user:{id:"admin",role:"admin",isActive:true,expiresAt:null,mustChangePassword:false},db:{} as any}));
vi.mock("@/lib/ai-config/vault",()=>({protect:JSON.stringify,unprotect:JSON.parse}));
vi.mock("@/lib/prisma",()=>({prisma:mock.db}));
vi.mock("@/lib/ai-access",()=>({AIRequestError:class extends Error{constructor(public status:number,message:string){super(message)}}}));
vi.mock("@/lib/ai-access/account",()=>({requireTxAiUser:async(_tx:unknown,_id:string,admin:boolean)=>{if(!mock.user.isActive || (admin&&mock.user.role!=="admin"))throw Error("AI_ACCESS_REVOKED");return mock.user}}));
import {getIllustrationSettings,saveIllustrationSettings,requireIllustrationAccess} from "@/lib/ai-drawing/illustration-settings";
const config={version:1,providers:[{id:"p",name:"MiniMax",protocol:"chat",baseUrl:"https://api.minimax.cn/v1",apiKey:"synthetic-test-key",enabled:true}],models:[],chains:{text:[],vision:[]}};
beforeEach(()=>{mock.rows.clear();mock.rows.set("site",{id:"site",revision:1,payload:JSON.stringify(config)});mock.user.role="admin";mock.user.isActive=true;
 mock.db.user={findUnique:vi.fn(async()=>mock.user)};
 mock.db.aiConfiguration={findUnique:vi.fn(async({where}:any)=>mock.rows.get(where.id)||null),create:vi.fn(async({data}:any)=>{mock.rows.set(data.id,data);return data}),updateMany:vi.fn(async({where,data}:any)=>{const old=mock.rows.get(where.id);if(!old||old.revision!==where.revision)return {count:0};mock.rows.set(where.id,{...old,...data,revision:old.revision+1});return {count:1}})};
 mock.db.$transaction=async(fn:any)=>fn(mock.db);
});
const save=()=>saveIllustrationSettings("admin",{providerId:"p",model:"image-01",revision:0,configRevision:1});
describe("site-only illustration authorization",()=>{
 it.each(["chat","responses","responses_codex"])("lists and authorizes the saved minimaxi.com connection with %s protocol and no text/vision models",async protocol=>{
  const next=structuredClone(config);Object.assign(next.providers[0],{baseUrl:"https://api.minimaxi.com/v1",protocol});
  mock.rows.set("site",{id:"site",revision:1,payload:JSON.stringify(next)});
  const view=await getIllustrationSettings("admin");expect(view.providers).toEqual([{id:"p",name:"MiniMax",baseUrl:"https://api.minimaxi.com/v1"}]);expect(JSON.stringify(view)).not.toContain("synthetic-test-key");
  await save();const access=await requireIllustrationAccess("admin",1);expect(access.provider.baseUrl).toBe("https://api.minimaxi.com/v1");
 });
 it.each([{enabled:false,apiKey:"synthetic-test-key"},{enabled:true,apiKey:""}])("still excludes disabled or keyless minimaxi.com connections %j",async fields=>{
  const next=structuredClone(config);Object.assign(next.providers[0],{baseUrl:"https://api.minimaxi.com/v1",...fields});mock.rows.set("site",{id:"site",revision:1,payload:JSON.stringify(next)});
  expect((await getIllustrationSettings("admin")).providers).toEqual([]);await expect(save()).rejects.toThrow();
 });
 it("starts disabled and exposes no credentials; accepts a provider without fake vision models",async()=>{
  const view=await getIllustrationSettings("admin");expect(view.enabled).toBe(false);expect(view.providers).toHaveLength(1);expect(JSON.stringify(view)).not.toContain("synthetic-test-key");
  await save();expect((await requireIllustrationAccess("admin",1)).model).toBe("image-01");expect(mock.rows.get("site").payload).toBe(JSON.stringify(config));
 });
 it("does not allow a non-admin to read, save or dispatch",async()=>{
  await save();mock.user.role="user";
  await expect(getIllustrationSettings("user")).rejects.toThrow();await expect(save()).rejects.toThrow();await expect(requireIllustrationAccess("user",1)).rejects.toThrow();
 });
 it.each(["apiKey","baseUrl","protocol"])("invalidates authorization when %s changes",async field=>{
  await save();const next=structuredClone(config);(next.providers[0] as any)[field]=field==="baseUrl"?"https://api.minimax.io/v1":field==="protocol"?"responses":"changed-key";
  mock.rows.set("site",{revision:2,payload:JSON.stringify(next)});
  expect((await getIllustrationSettings("admin")).enabled).toBe(false);await expect(requireIllustrationAccess("admin",1)).rejects.toThrow();
 });
 it("requires fresh configuration and settings revisions",async()=>{
  await expect(saveIllustrationSettings("admin",{providerId:"p",model:"image-01",revision:0,configRevision:0})).rejects.toThrow("CONFIG_CONFLICT");await save();await expect(save()).rejects.toThrow("CONFIG_CONFLICT");await expect(requireIllustrationAccess("admin",2)).rejects.toThrow();
 });
 it("supports disabling without a configured text chain and never transfers an old permission",async()=>{
  await save();await saveIllustrationSettings("admin",{providerId:null,model:"image-01",revision:1,configRevision:1});await expect(requireIllustrationAccess("admin",2)).rejects.toThrow();
 });
});
