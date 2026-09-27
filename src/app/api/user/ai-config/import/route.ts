import { z } from "zod";
import { aiJson, requireUser } from "@/lib/ai-access";
import { openExport } from "@/lib/ai-config/crypto";
import { emptyConfig, mergeConfig } from "@/lib/ai-config/schema";
import { PrivateConfigSchema, parsePrivateEdit } from "@/lib/ai-access/private-editor";
import { persistPrivateConfig, readPrivateConfig } from "@/lib/ai-access/private-store";
import { accessError, conflict } from "@/lib/ai-access/errors";
import { readAccessMutation } from "@/lib/ai-access/http";
export const runtime="nodejs";
const base={revision:z.number().int().nonnegative(),mode:z.enum(["merge","replace"])};
const schema=z.discriminatedUnion("format",[
 z.object({...base,format:z.literal("portable"),config:z.unknown()}).strict(),
 z.object({...base,format:z.literal("encrypted"),envelope:z.unknown(),password:z.string().min(12).max(1024)}).strict(),
]);
/** One bounded CAS apply. No decrypted preview token, export, site-key lookup or remote URL import. */
export async function POST(req:Request){try{
    const user=await requireUser(req), body=schema.parse(await readAccessMutation(req,user.id,"import"));
    const current=await readPrivateConfig(user.id);if(current.revision!==body.revision)conflict();
    const raw=body.format==="encrypted"?await openExport(body.envelope,body.password):body.config;
    // Imported masks are NEVER instructions to borrow an existing private/site credential.
    const incoming=parsePrivateEdit(raw,emptyConfig());
    const config=PrivateConfigSchema.parse(body.mode==="merge"?mergeConfig(current.config,incoming):incoming);
    return aiJson(await persistPrivateConfig(user.id,config,body.revision,user.sessionVersion));
}catch(e){return accessError(e);}}
