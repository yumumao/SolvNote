import { validateDrawingInput } from "../ai-drawing/service";
import { NextResponse } from "next/server";
import { requireUser, requireAdmin, assertSameOrigin } from "../ai-access";
import { readJSON, safeError } from "../ai-http";
import { prisma } from "../prisma";
import { calculateGrade } from "../grade-calculator";
import { submitJob } from "./store";
import { JobInputSchema, type JobKind } from "./schema";
export async function enqueue(
    req: Request,
    kind: JobKind,
    errorItemId?: string,
) {
    try {
        const media = kind==="illustration" || kind==="illustration_describe";
        const user = media?await requireAdmin(req):await requireUser(req);
        assertSameOrigin(req);
        let body = await readJSON(req, kind==="illustration"?16 * 1024:kind==="illustration_describe"?9 * 1024 * 1024:25 * 1024 * 1024);
        if (!media && (kind === "practice" || errorItemId)) {
            const id = errorItemId || body.errorItemId;
            if (typeof id !== "string") throw Error("INVALID_REQUEST");
            const item = await prisma.errorItem.findFirst({
                where: { id, userId: user.id },
                include: { subject: true },
            });
            if (!item)
                return NextResponse.json(
                    { message: "NOT_FOUND" },
                    { status: 404 },
                );
            let tags = [];
            try {
                tags = JSON.parse(item.knowledgePoints || "[]");
            } catch {}
            body = {
                ...body,
                questionText: body.questionText || item.questionText,
                answerText: body.answerText || item.answerText,
                analysis: body.analysis || item.analysis,
                gradeSemester: item.gradeSemester,
                subject: item.subject?.name,
                tags,
                errorItemId: id,
                imageBase64:
                    body.imageBase64 ||
                    (item.originalImageUrl?.startsWith("data:image/")
                        ? item.originalImageUrl
                        : undefined),
            };
        }
        if (!media && body.subjectId) {
            const subject = await prisma.subject.findFirst({
                where: { id: body.subjectId, userId: user.id },
            });
            if (!subject)
                return NextResponse.json(
                    { message: "NOT_FOUND" },
                    { status: 404 },
                );
            body.subject = subject.name;
        }
        if (!media && !body.gradeSemester) {
            const profile = await prisma.user.findUnique({
                where: { id: user.id },
                select: { educationStage: true, enrollmentYear: true },
            });
            if (profile?.educationStage && profile.enrollmentYear)
                body.gradeSemester = calculateGrade(
                    profile.educationStage,
                    profile.enrollmentYear,
                    new Date(),
                    "zh",
                );
        }
        const input = JobInputSchema.parse(body);
        if(kind === "construction" || kind === "image_edit")await validateDrawingInput(kind,input,user.id);
        const key = req.headers.get("x-request-id") || crypto.randomUUID();
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw Error("INVALID_REQUEST");
        const job = await submitJob(user.id, kind, input, key);
        return NextResponse.json(
            {
                jobId: job.id,
                state: job.state,
                statusUrl: `/api/ai/jobs/${job.id}`,
            },
            { status: 202, headers: { "Cache-Control": "no-store" } },
        );
    } catch (e) {
        return safeError(e);
    }
}
