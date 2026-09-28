import { readableJobWhere } from "@/lib/solving-records/retention";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/ai-access";
import { prisma } from "@/lib/prisma";
import { publicJob } from "@/lib/ai-jobs/store";
import { safeError } from "@/lib/ai-http";
export async function GET(req: Request) {
    try {
        const u = await requireUser(req);
        const jobs = await prisma.aiJob.findMany({
            where: { userId: u.id, conversationId: null, ...readableJobWhere() },
            orderBy: { createdAt: "desc" },
            take: 50,
            // List refreshes need metadata, never encrypted multi-megabyte images/results.
            select: { id:true, kind:true, state:true, attempts:true, errorCode:true, createdAt:true, updatedAt:true },
        });
        return NextResponse.json(
            { jobs: jobs.map(publicJob) },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (e) {
        return safeError(e);
    }
}
