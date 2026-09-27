// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai-config/vault",()=>({masterKey:()=>Buffer.alloc(32,7)}));
import { protectUserConfig, unprotectUserConfig } from "@/lib/ai-access/private-vault";
import { parsePrivateEdit, privateConfigDTO } from "@/lib/ai-access/private-editor";
import { emptyConfig } from "@/lib/ai-config/schema";
const config=()=>({...emptyConfig(),providers:[{id:"p",name:"Private",protocol:"chat" as const,baseUrl:"https://example.com/v1",apiKey:"synthetic-private-only",enabled:true}]});
beforeEach(()=>vi.clearAllMocks());
describe("private AI vault and redacted editor",()=>{
 it("encrypts with owner-bound authenticated data and fails for another owner or tampering",()=>{
  const payload=protectUserConfig("alice",config());expect(payload).not.toContain("synthetic-private-only");
  expect(unprotectUserConfig("alice",payload)).toEqual(config());
  expect(()=>unprotectUserConfig("bob",payload)).toThrow();
  const v=JSON.parse(payload);v.data=v.data.slice(0,-4)+"AAAA";expect(()=>unprotectUserConfig("alice",JSON.stringify(v))).toThrow();
 });
 it("never returns a key, retains it only for the exact previous recipient",()=>{
  const c=config(), dto=privateConfigDTO(c);expect(JSON.stringify(dto)).not.toContain("synthetic-private-only");
  expect(dto.providers[0]).toMatchObject({hasKey:true});expect(dto.providers[0]).not.toHaveProperty("apiKey");
  const edit={...c,providers:c.providers.map(({apiKey,...p})=>({...p,apiKey:"********"}))};
  expect(parsePrivateEdit(edit,c).providers[0].apiKey).toBe("synthetic-private-only");
  edit.providers[0].baseUrl="https://attacker.example/v1";expect(()=>parsePrivateEdit(edit,c)).toThrow("PRIVATE_KEY_REQUIRED");
 });
 it("rejects unknown fields, oversized private catalogs and foreign masks on first import",()=>{
  expect(()=>parsePrivateEdit({...config(),userId:"victim"},emptyConfig())).toThrow();
  expect(()=>parsePrivateEdit({...config(),providers:[{...config().providers[0],apiKey:"********"}]},emptyConfig())).toThrow();
 });
});
