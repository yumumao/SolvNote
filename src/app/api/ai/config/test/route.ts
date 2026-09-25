import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, assertSameOrigin } from "@/lib/ai-access";
import { readJSON, safeError } from "@/lib/ai-http";
import { loadAIConfig } from "@/lib/ai-config/store";
import { AIError, sendAI } from "@/lib/ai/transport";
export const runtime = "nodejs";
const inputSchema = z.object({ modelId: z.string().min(1).max(128), revision: z.number().int().nonnegative() }).strict();
// A bounded administrative diagnostic, not a solver job. Never falls back or retries.
// This lock prevents overlapping probes in this process; it is not a distributed quota.
let testing = false;
const publicCodes = new Set(["AI_ENDPOINT_REJECTED", "AI_ACCEPTANCE_UNKNOWN", "AI_AUTH_ERROR", "AI_RATE_LIMIT", "AI_RESPONSE_ERROR", "AI_HTTP_400", "AI_HTTP_404", "AI_HTTP_500", "AI_HTTP_502", "AI_HTTP_503"]);
function json(body: unknown, status = 200) { return NextResponse.json(body, {status, headers:{"Cache-Control":"no-store"}}); }
export async function POST(req: Request) {
    let acquired = false;
    try {
        await requireAdmin(req); assertSameOrigin(req);
        const input = inputSchema.parse(await readJSON(req, 2048));
        const {config, revision} = await loadAIConfig();
        if (input.revision !== revision) throw Error("CONFIG_CONFLICT");
        const model = config.models.find(m => m.id === input.modelId);
        const provider = config.providers.find(p => p.id === model?.providerId);
        if (!model?.enabled || !provider?.enabled || !model.capabilities.includes("text")) throw Error("INVALID_REQUEST");
        if (testing) return json({success:false,code:"AI_TEST_BUSY"}, 429);
        testing = acquired = true;
        const started = Date.now();
        try {
            const reply = await sendAI(provider, model, "This is a connectivity test. Reply with only OK.", "Please reply OK.", undefined,
                AbortSignal.any([req.signal, AbortSignal.timeout(20000)]));
            if (!reply.trim()) throw new AIError("AI_RESPONSE_ERROR");
            return json({success:true, elapsedMs:Date.now()-started, tested:"text"});
        } catch (error) {
            const code = error instanceof AIError && publicCodes.has(error.code) ? error.code : "AI_ACCEPTANCE_UNKNOWN";
            return json({success:false, code, elapsedMs:Date.now()-started}, 502);
        }
    } catch (error) { return safeError(error); }
    finally { if (acquired) testing = false; }
}
