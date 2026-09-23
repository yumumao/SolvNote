import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/ai-access";
import { safeError } from "@/lib/ai-http";
import { canonicalSiteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

/** Safe admin diagnostics. No request/proxy hosts, path, query or credentials. */
export async function GET(req: Request) {
    let response: NextResponse;
    try {
        await requireAdmin(req);
        let state = "missing", canonicalOrigin: string | null = null;
        if (process.env.NEXTAUTH_URL) {
            try {canonicalOrigin = canonicalSiteOrigin(req.url); state = "configured";}
            catch {state = "invalid";}
        }
        response = NextResponse.json({state, canonicalOrigin});
    } catch (error) {response = safeError(error);}
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie");
    return response;
}
