import { NextResponse } from "next/server";
import { requireUser } from "@/lib/ai-access";
import { prisma } from "@/lib/prisma";
import { publicJob } from "@/lib/ai-jobs/store";
import { safeError } from "@/lib/ai-http";
export async function GET(req: Request) {
    try {
        const u = await requireUser(req);
        const jobs = await prisma.aiJob.findMany({
            where: { userId: u.id, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return NextResponse.json(
            { jobs: jobs.map(publicJob) },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (e) {
        return safeError(e);
    }
}
