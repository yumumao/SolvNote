import { NextResponse } from "next/server";
import template from "../../../../../../docs/templates/solvnote-ai-config.template.json";

/** Public synthetic example only. Never derive this response from saved configuration. */
export async function GET() {
    return NextResponse.json(template, { headers: {
        "Content-Disposition": 'attachment; filename="solvnote-ai-config.template.json"',
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    } });
}
