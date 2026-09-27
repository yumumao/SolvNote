import { NextResponse } from "next/server";
import { AIRequestError, assertSameOrigin, readAIJson, requireAdmin } from "@/lib/ai-access";
import { safeError } from "@/lib/ai-http";
import { loadAIConfig } from "@/lib/ai-config/store";
import { sealExport } from "@/lib/ai-config/crypto";
import { assertAiConfigExportEnabled, isAiConfigExportEnabled } from "@/lib/ai-config/export-policy";

export const runtime = "nodejs";

/** A non-cacheable server capability only; never load config, keys or a vault. */
export async function GET(req: Request) {
    let response: NextResponse;
    try {
        await requireAdmin(req);
        response = NextResponse.json({ exportEnabled: isAiConfigExportEnabled() });
    } catch (error) {
        response = safeError(error);
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie");
    return response;
}

/** Export saved server-side keys only when the deployment explicitly permits it. */
export async function POST(req: Request) {
    let response: NextResponse;
    try {
        const actor = await requireAdmin(req);
        const assertStillAuthorized = async () => {
            const current = await requireAdmin(req);
            if (current.id !== actor.id || current.sessionVersion !== actor.sessionVersion)
                throw new AIRequestError(403, "Access denied");
        };
        assertSameOrigin(req);
        assertAiConfigExportEnabled();
        const body = await readAIJson(req, 8192) as { password?: unknown; revision?: unknown } | null;
        if (!body || typeof body.password !== "string" || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
            throw Error("INVALID_REQUEST");
        if (body.password.length < 12 || body.password.length > 1024 || !body.password.trim()) throw Error("PASSPHRASE_LENGTH");
        // Recheck after the body; reset/demotion during a slow upload must not read keys.
        await assertStillAuthorized();
        // Export never lazily creates a row/key or saves edits from the browser.
        const current = await loadAIConfig({persist: false});
        if (body.revision !== current.revision) throw Error("CONFIG_CONFLICT");
        const envelope = await sealExport(current.config, body.password);
        // Encryption can be slow. Never release an envelope to a revoked session.
        await assertStillAuthorized();
        response = NextResponse.json(envelope, {headers: {
            "Content-Disposition": 'attachment; filename="solvnote.aiconfig.enc.json"',
            "X-Content-Type-Options": "nosniff",
        }});
    } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "AI_CONFIG_EXPORT_DISABLED") {
            response = NextResponse.json({message: "AI_CONFIG_EXPORT_DISABLED"}, {status: 403});
        } else if (["PASSPHRASE_LENGTH", "EXPORT_TOO_LARGE"].includes(code)) {
            response = NextResponse.json({message: code}, {status: code === "EXPORT_TOO_LARGE" ? 413 : 400});
        } else if (code === "Cross-origin request denied") {
            response = NextResponse.json({message: "IMPORT_ORIGIN_REJECTED"}, {status: 403});
        } else if (error instanceof AIRequestError && [413, 415].includes(error.status)) {
            response = NextResponse.json({message: error.status === 415 ? "JSON_REQUIRED" : "BODY_TOO_LARGE"}, {status: error.status});
        } else response = safeError(error);
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie");
    return response;
}
