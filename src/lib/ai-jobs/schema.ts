import { z } from "zod";
import { ConstructionSchema } from "../ai-drawing/construction";
export const JobInputSchema = z
    .object({
        drawingPlan: ConstructionSchema.optional(),
        drawingRevision: z.number().int().min(1).optional(),
        confirmImageEdit: z.literal(true).optional(),
        originalImageBase64: z
            .string()
            .max(12 * 1024 * 1024)
            .optional(),
        questionText: z.string().max(50000).default(""),
        drawingCorrection: z.string().max(10000).default(""),
        imageBase64: z
            .string()
            .max(12 * 1024 * 1024)
            .optional(),
        mimeType: z
            .enum(["image/jpeg", "image/png", "image/webp"])
            .default("image/jpeg"),
        language: z.enum(["zh", "en"]).default("zh"),
        subjectId: z.string().max(100).optional(),
        subject: z.string().max(100).nullable().optional(),
        gradeSemester: z.string().max(100).nullable().optional(),
        grade: z
            .union([
                z.literal(7),
                z.literal(8),
                z.literal(9),
                z.literal(10),
                z.literal(11),
                z.literal(12),
            ])
            .nullable()
            .optional(),
        mode: z.enum(["direct", "transcribe", "text"]).default("direct"),
        review: z.boolean().default(false),
        tags: z.array(z.string().max(200)).max(20).default([]),
        difficulty: z
            .enum(["easy", "medium", "hard", "harder"])
            .default("medium"),
        answerText: z.string().max(50000).default(""),
        analysis: z.string().max(50000).default(""),
        previousErrors: z.string().max(10000).default(""),
        errorItemId: z.string().max(100).optional(),
    })
    .superRefine((v, ctx) => {
        if (!v.questionText.trim() && !v.imageBase64)
            ctx.addIssue({ code: "custom", message: "MISSING_QUESTION" });
        if (
            v.originalImageBase64 &&
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
                v.originalImageBase64,
            )
        )
            ctx.addIssue({ code: "custom", message: "INVALID_ORIGINAL_IMAGE" });
        if (v.imageBase64) {
            const image = v.imageBase64.startsWith("data:")
                ? v.imageBase64
                : `data:${v.mimeType};base64,${v.imageBase64}`;
            if (
                !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
                    image,
                )
            )
                ctx.addIssue({ code: "custom", message: "INVALID_IMAGE" });
        }
        if (v.mode === "text" && v.imageBase64)
            ctx.addIssue({
                code: "custom",
                message: "IMAGE_CANNOT_BE_DROPPED",
            });
        if (v.mode === "transcribe" && !v.imageBase64)
            ctx.addIssue({
                code: "custom",
                message: "TRANSCRIPTION_NEEDS_IMAGE",
            });
    });
export type JobInput = z.infer<typeof JobInputSchema>;
export type JobKind = "analyze" | "reanswer" | "practice" | "geogebra" | "construction" | "image_edit";
export const terminalStates = [
    "success",
    "failed",
    "unknown",
    "cancelled",
] as const;