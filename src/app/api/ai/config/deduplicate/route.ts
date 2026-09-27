import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, assertSameOrigin } from "@/lib/ai-access";
import { readJSON, safeError } from "@/lib/ai-http";
import { loadAIConfig, saveAIConfig } from "@/lib/ai-config/store";
import { redactConfig, type PortableConfig } from "@/lib/ai-config/schema";
import { deduplicateConfig, type MergeChoice } from "@/lib/ai-config/deduplicate";
import { masterKey } from "@/lib/ai-config/vault";

export const runtime = "nodejs";
const ttl = 5 * 60 * 1000;
const headers = { "Cache-Control": "no-store" };
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:@/-]+$/);
const choices = z.array(z.object({
    kind: z.enum(["connection", "model"]), groupId: id, keepId: id.nullable(),
}).strict()).max(250).default([]);
const Body = z.discriminatedUnion("action", [
    z.object({ action: z.literal("preview"), choices }).strict(),
    z.object({ action: z.literal("apply"), choices,
        revision: z.number().int().nonnegative().safe(), expires: z.number().int().positive().safe(),
        nonce: z.string().regex(/^[a-f0-9]{32}$/), previewToken: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
]);
function token(user: string, config: PortableConfig, selected: MergeChoice[], revision: number, expires: number, nonce: string) {
    // The per-preview nonce prevents a stable credential/config fingerprint.
    // Domain + user + choices prevents reuse by import or another administrator.
    return createHmac("sha256", masterKey(false))
        .update(JSON.stringify(["deduplicate-v1", user, config, selected, revision, expires, nonce]))
        .digest("hex");
}
export async function POST(req: Request) {
    try {
        const user = await requireAdmin(req);
        assertSameOrigin(req);
        const body = Body.parse(await readJSON(req, 64 * 1024));
        const current = await loadAIConfig({ persist: false });
        // Detection only handles a saved snapshot; never migrate or create keys.
        if (current.revision === 0) throw Error("CONFIG_CONFLICT");
        const result = deduplicateConfig(current.config, body.choices);
        if (body.action === "preview") {
            const expires = Date.now() + ttl, nonce = randomBytes(16).toString("hex");
            return NextResponse.json({
                ...result, before: redactConfig(current.config), config: redactConfig(result.config),
                revision: current.revision, expires, nonce,
                previewToken: token(user.id, current.config, body.choices, current.revision, expires, nonce),
            }, { headers });
        }
        if (body.revision !== current.revision || body.expires < Date.now() || body.expires > Date.now() + ttl || !result.changed)
            throw Error("CONFIG_CONFLICT");
        const expected = token(user.id, current.config, body.choices, current.revision, body.expires, body.nonce);
        if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(body.previewToken, "hex"))) throw Error("INVALID_REQUEST");
        // Save is a CAS; concurrent changes and replay fail without overwriting.
        const revision = await saveAIConfig(result.config, current.revision, user);
        return NextResponse.json({ config: redactConfig(result.config), revision }, { headers });
    } catch (error) {
        const response = safeError(error);
        response.headers.set("Cache-Control", "no-store");
        return response;
    }
}
