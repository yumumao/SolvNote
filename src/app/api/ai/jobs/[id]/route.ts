import { NextResponse } from "next/server";
import { requireUser, assertSameOrigin } from "@/lib/ai-access";
import { readJob, cancelJob } from "@/lib/ai-jobs/store";
import { safeError } from "@/lib/ai-http";
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const u = await requireUser(req);
        const { id } = await params;
        const job = await readJob(
            u.id,
            id,
            new URL(req.url).searchParams.get("restore") === "1",
        );
        return NextResponse.json(job || { message: "NOT_FOUND" }, {
            status: job ? 200 : 404,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (e) {
        return safeError(e);
    }
}
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const u = await requireUser(req);
        assertSameOrigin(req);
        const { id } = await params;
        const job = await cancelJob(u.id, id);
        return NextResponse.json(job || { message: "NOT_FOUND" }, {
            status: job ? 200 : 404,
        });
    } catch (e) {
        return safeError(e);
    }
}
