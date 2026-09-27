// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/transport", async (original) => ({ ...(await original<typeof import("@/lib/ai/transport")>()), sendAI: send }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiCooldown: { findUnique: vi.fn(async () => null) } } }));
vi.mock("@/lib/ai-access/effective-config", () => ({ loadEffectiveAIConfig: vi.fn(), assertModelsAllowedForUser:vi.fn(async()=>({})) }));
import {loadEffectiveAIConfig} from "@/lib/ai-access/effective-config";
import { callChain } from "@/lib/ai/chain";
import { aiRun } from "@/lib/ai-jobs/context";
import type { PortableConfig } from "@/lib/ai-config/schema";
const config: PortableConfig = {
 version: 1, providers: [{id:"p", name:"Synthetic connection", protocol:"chat", baseUrl:"https://example.invalid/v1", apiKey:"fixture", enabled:true}],
 models: [
  {id:"text",name:"Text",model:"text",providerId:"p",capabilities:["text"],enabled:true},
  {id:"vision",name:"Vision",model:"vision",providerId:"p",capabilities:["text","vision"],enabled:true}
 ], chains:{text:["text","vision"],vision:["vision"]}
};
const run = (fn: () => Promise<unknown>, c = config) => { vi.mocked(loadEffectiveAIConfig).mockResolvedValue({config:c} as Awaited<ReturnType<typeof loadEffectiveAIConfig>>);return aiRun.run({userId:"fixture",config:c,signal:new AbortController().signal,deadline:Date.now()+10000,attempts:0,maxAttempts:6},fn); };
beforeEach(() => { send.mockResolvedValue("ok"); });
describe("role routing", () => {
 it("uses solver order even with an image, never sends image to text model", async () => {
  await run(() => callChain("p","t","data:image/png;base64,YQ==",s=>s,{role:"solve",stage:"solve"}));
  expect(send.mock.calls[0][1].id).toBe("text");
  expect(send.mock.calls[0][4]).toBeUndefined();
 });
 it("attaches image to a capable solver", async () => {
  await run(() => callChain("p","t","image",s=>s,{role:"solve",stage:"solve"}), {...config,chains:{...config.chains,text:["vision"]}});
  expect(send.mock.calls[0][4]).toBe("image");
 });
 it("selects only vision chain for recognition", async () => {
  await run(() => callChain("p","t","image",s=>s,{role:"recognize",stage:"recognize"}));
  expect(send.mock.calls[0][1].id).toBe("vision");
 });
 it("honors the original solver on continuation", async () => {
  await run(() => callChain("p","t",undefined,s=>s,{role:"solve",stage:"solve",modelId:"vision"}));
  expect(send.mock.calls[0][1].id).toBe("vision");
 });
});
