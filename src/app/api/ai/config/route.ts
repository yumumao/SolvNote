import { NextResponse } from "next/server";
import { requireAdmin, assertSameOrigin } from "@/lib/ai-access";
import { readJSON, safeError } from "@/lib/ai-http";
import { loadAIConfig, saveAIConfig } from "@/lib/ai-config/store";
import { parseConfig, redactConfig } from "@/lib/ai-config/schema";

export const runtime = "nodejs";

// Both configs are schema-validated: HTTPS, no userinfo, query or fragment.
function normalizedBaseUrl(value: string) {
    return new URL(value).href.replace(/\/+$/, "");
}

export async function GET(req: Request) {
    try {
        await requireAdmin(req);
        const { config, revision } = await loadAIConfig();
        return NextResponse.json(
            { config: redactConfig(config), revision },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (error) {
        return safeError(error);
    }
}

export async function POST(req: Request) {
    try {
        await requireAdmin(req);
        assertSameOrigin(req);
        const body = await readJSON(req);
        const current = await loadAIConfig();
        const config = parseConfig(body.config);
        for (const provider of config.providers) {
            if (provider.apiKey !== "********") continue;
            const original = current.config.providers.find(
                (saved) => saved.id === provider.id,
            );
            // An ID alone is not consent to disclose its saved key to a new
            // endpoint/protocol. Changing the target requires an explicit key.
            if (
                !original ||
                original.protocol !== provider.protocol ||
                normalizedBaseUrl(original.baseUrl) !==
                    normalizedBaseUrl(provider.baseUrl)
            ) {
                throw Error("INVALID_REQUEST");
            }
            provider.apiKey = original.apiKey;
        }
        if (!Number.isInteger(body.revision)) throw Error("INVALID_REQUEST");
        const revision = await saveAIConfig(config, body.revision);
        return NextResponse.json({ config: redactConfig(config), revision });
    } catch (error) {
        return safeError(error);
    }
}
