import { describe, expect, it } from "vitest";
import { assertDefaultModelSelection, buildNewUserSiteGrants, listConfiguredSiteModels, siteModelFingerprint } from "@/lib/ai-access/policy";
import { privateRuntimeConfig, mergeEffectiveConfig } from "@/lib/ai-access/compose";
import { emptyConfig, type PortableConfig } from "@/lib/ai-config/schema";
export const fixture = (): PortableConfig => ({version:1,providers:[{id:"p",name:"Provider",protocol:"chat",baseUrl:"https://example.com/v1",apiKey:"synthetic-test-only",enabled:true}],models:[1,2,3,4].map(n=>({id:`m${n}`,providerId:"p",name:`Model ${n}`,model:`upstream-${n}`,capabilities:["text"],enabled:true})),chains:{text:["m1","m2","m3","m4"],vision:[]}});
describe("AI access policy",()=>{
 it("requires exactly three distinct available defaults, or all when catalog smaller",()=>{
  const ids=new Set(["m1","m2","m3","m4"]);
  expect(()=>assertDefaultModelSelection(["m1","m2","m3"],ids)).not.toThrow();
  for(const bad of [["m1"],["m1","m1","m2"],["m1","m2","m3","m4"]])expect(()=>assertDefaultModelSelection(bad,ids)).toThrow("DEFAULT_MODEL_LIMIT");
  expect(()=>assertDefaultModelSelection(["m1","m2","unknown"],ids)).toThrow("MODEL_NOT_AVAILABLE");
  expect(()=>assertDefaultModelSelection(["m1"],new Set(["m1"]))).not.toThrow();
  expect(()=>assertDefaultModelSelection([],new Set())).not.toThrow();
 });
 it("creates ordered keyless snapshot grant rows",()=>expect(buildNewUserSiteGrants(["m3","m1","m2"])).toEqual([{modelId:"m3",source:"default",rank:1},{modelId:"m1",source:"default",rank:2},{modelId:"m2",source:"default",rank:3}]));
 it("lists only enabled models and never exposes connection details or keys",()=>{
  const c=fixture();c.models[3].enabled=false;const dto=listConfiguredSiteModels(c);
  expect(dto.map(m=>m.id)).toEqual(["m1","m2","m3"]);expect(JSON.stringify(dto)).not.toMatch(/apiKey|synthetic-test-only|baseUrl/);
 });
 it("binds a stable model ID to recipient, not its display name or rotating key",()=>{
  const c=fixture(), original=siteModelFingerprint(c,c.models[0]);
  c.providers[0].apiKey="rotated-synthetic";c.models[0].name="renamed";expect(siteModelFingerprint(c,c.models[0])).toBe(original);
  c.providers[0].baseUrl="https://elsewhere.example/v1";expect(siteModelFingerprint(c,c.models[0])).not.toBe(original);
 });
 it("namespaces private IDs by owner and merges only allowed site providers",()=>{
  const privateA=privateRuntimeConfig("alice",fixture()), privateB=privateRuntimeConfig("bob",fixture());
  expect(privateA.models[0].id).not.toBe(privateB.models[0].id);expect(privateA.models[0].id).toMatch(/^private\//);
  const c=mergeEffectiveConfig(fixture(),new Set(["m2"]),privateA);
  expect(c.models.filter(m=>!m.id.startsWith("private/")).map(m=>m.id)).toEqual(["m2"]);
  expect(c.chains.text).not.toContain("m1");expect(c.chains.text).toContain(privateA.models[0].id);
  expect(mergeEffectiveConfig(fixture(),new Set(),emptyConfig()).providers).toEqual([]);
 });
});
