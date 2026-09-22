import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin, assertSameOrigin } from "@/lib/ai-access";
import { readJSON, safeError } from "@/lib/ai-http";
import { openExport } from "@/lib/ai-config/crypto";
import { loadAIConfig, saveAIConfig } from "@/lib/ai-config/store";
import {
    mergeConfig,
    redactConfig,
    type PortableConfig,
} from "@/lib/ai-config/schema";
import { ImportConfigError } from "@/lib/ai-config/import-errors";
import { masterKey } from "@/lib/ai-config/vault";

export const runtime = "nodejs";

function token(
    user: string,
    config: PortableConfig,
    revision: number,
    expires: number,
    createKey = false,
) {
    return createHmac("sha256", masterKey(createKey))
        .update(JSON.stringify(["import-v1", user, config, revision, expires]))
        .digest("hex");
}

export async function POST(req: Request) {
    let stage: "request" | "decrypt" | "storage" | "merge" | "confirm" = "request";
    try {
        const user = await requireAdmin(req);
        assertSameOrigin(req);
        const body = await readJSON(req, 1024 * 1024 + 8192);
        if (
            !["merge", "replace"].includes(body.mode) ||
            typeof body.password !== "string"
        )
            throw Error("INVALID_REQUEST");
        stage = "decrypt";
        const incoming = await openExport(body.envelope, body.password);
        // Import must never persist legacy migration merely to preview or to
        // reject an invalid apply. Existing rows still require the existing key.
        stage = "storage";
        const current = await loadAIConfig({ persist: false });
        stage = "merge";
        const config =
            body.mode === "merge"
                ? mergeConfig(current.config, incoming)
                : incoming;
        stage = "confirm";
        if (body.action === "preview") {
            stage = "storage";
            const expires = Date.now() + 5 * 60 * 1000;
            return NextResponse.json(
                {
                    config: redactConfig(config),
                    revision: current.revision,
                    expires,
                    // On a fresh installation only a key may be created; not a row.
                    previewToken: token(
                        user.id,
                        config,
                        current.revision,
                        expires,
                        current.revision === 0,
                    ),
                },
                { headers: { "Cache-Control": "no-store" } },
            );
        }
        if (
            body.action !== "apply" ||
            !Number.isSafeInteger(body.expires) ||
            body.expires < Date.now() ||
            body.expires > Date.now() + 5 * 60 * 1000 ||
            body.revision !== current.revision ||
            typeof body.previewToken !== "string" ||
            !/^[a-f0-9]{64}$/.test(body.previewToken)
        )
            throw Error("CONFIG_CONFLICT");
        // Verification must not regenerate a lost key, even before the first row.
        stage = "storage";
        const expected = Buffer.from(
            token(user.id, config, current.revision, body.expires),
            "hex",
        );
        if (!timingSafeEqual(expected, Buffer.from(body.previewToken, "hex")))
            throw Error("IMPORT_PREVIEW_INVALID");
        const revision = await saveAIConfig(config, current.revision);
        return NextResponse.json({ revision, config: redactConfig(config) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        // Expose only fixed diagnostics. Never serialize validators, DB/crypto
        // exceptions, provider labels, addresses, passwords or API keys.
        let response: NextResponse;
        const code = error instanceof Error ? error.message : "";
        const publicCodes = new Set([
            "INVALID_EXPORT", "UNSUPPORTED_EXPORT", "INVALID_EXPORT_PAYLOAD",
            "INVALID_EXPORT_OR_PASSPHRASE", "AI_MASTER_KEY_MISSING",
            "AI_MASTER_KEY_INVALID", "IMPORT_PREVIEW_INVALID", "INVALID_REQUEST",
        ]);
        if (error instanceof ImportConfigError) {
            response = NextResponse.json({ message: error.message, issues: error.issues }, { status: 400 });
        } else if (code === "Cross-origin request denied") {
            response = NextResponse.json({ message: "IMPORT_ORIGIN_REJECTED" }, { status: 403 });
        } else if (publicCodes.has(code)) {
            response = NextResponse.json({ message: code }, { status: 400 });
        } else if (code === "CONFIG_CONFLICT" || stage === "request") {
            response = safeError(error);
        } else {
            response = NextResponse.json({ message: stage === "storage" ? "IMPORT_STORAGE_UNAVAILABLE"
                : stage === "merge" ? "IMPORT_MERGE_INCOMPATIBLE" : "INVALID_REQUEST_OR_CONFIGURATION" }, { status: 400 });
        }
        response.headers.set("Cache-Control", "no-store");
        return response;
    }
}
