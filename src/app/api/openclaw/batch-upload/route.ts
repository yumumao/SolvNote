import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { calculateGrade } from "@/lib/grade-calculator";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";
import { requireUser, assertSameOrigin, aiErrorResponse, AIRequestError } from "@/lib/ai-access";

const logger = createLogger('api:openclaw:batch-upload');

const MAX_IMAGES = 20;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

interface ImageData {
    base64: string;
    mimeType: string;
    filename: string;
}

interface OpenclawResponse {
    success: boolean;
    data?: {
        questionText: string;
        answerText: string;
        analysis: string;
        knowledgePoints: string[];
        subject?: string;
        errorType?: string;
        source?: string;
    };
    error?: string;
}

function validateImage(base64: string, filename: string): { valid: boolean; error?: string } {
    if (!base64 || base64.length === 0) {
        return { valid: false, error: '图片数据为空' };
    }

    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return { valid: false, error: `不支持的图片格式: ${extension}，仅支持 JPG、PNG` };
    }

    const estimatedSize = (base64.length * 3) / 4;
    if (estimatedSize > MAX_IMAGE_SIZE) {
        return { valid: false, error: `图片大小超过限制: ${Math.round(estimatedSize / 1024 / 1024)}MB > 5MB` };
    }

    return { valid: true };
}

async function callOpenclawAgent(imageBase64: string, mimeType: string, timeout: number): Promise<OpenclawResponse> {
    const openclawUrl = process.env.OPENCLAW_API_URL || 'http://localhost:8080';
    const openclawApiKey = process.env.OPENCLAW_API_KEY || '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`${openclawUrl}/api/recognize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(openclawApiKey ? { 'Authorization': `Bearer ${openclawApiKey}` } : {}),
            },
            body: JSON.stringify({
                image: imageBase64,
                mimeType: mimeType,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.error({ status: response.status }, 'Openclaw agent error');
            return {
                success: false,
                error: `识别服务异常: HTTP ${response.status}`,
            };
        }

        const data = await response.json() as OpenclawResponse;
        return data;
    } catch (error: unknown) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
            logger.error('Openclaw agent timeout');
            return {
                success: false,
                error: '识别服务超时',
            };
        }
        
        logger.error('Openclaw agent request failed');
        return {
            success: false,
            error: '识别服务请求失败',
        };
    }
}

async function createErrorItem(
    userId: string,
    imageBase64: string,
    mimeType: string,
    parsedData: OpenclawResponse['data'],
    subjectId?: string
) {
    const { questionText, answerText, analysis, knowledgePoints, errorType, source } = parsedData || {};

    const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];
    const tagConnections: { id: string }[] = [];

    const subject = subjectId ? await prisma.subject.findUnique({ where: { id: subjectId } }) : null;
    const subjectKey = subject ? inferSubjectFromName(subject.name) : null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { educationStage: true, enrollmentYear: true }
    });

    let finalGradeSemester: string | null = null;
    if (user?.educationStage && user?.enrollmentYear) {
        finalGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear);
    }

    for (const tagName of tagNames) {
        try {
            let tag = await prisma.knowledgeTag.findFirst({
                where: {
                    name: tagName,
                    OR: [
                        { isSystem: true },
                        { userId: userId },
                    ],
                },
            });

            if (!tag) {
                const parentId = finalGradeSemester && subjectKey 
                    ? await findParentTagIdForGrade(finalGradeSemester, subjectKey)
                    : null;

                tag = await prisma.knowledgeTag.create({
                    data: {
                        name: tagName,
                        subject: subjectKey || 'other',
                        isSystem: false,
                        userId: userId,
                        parentId: parentId || undefined,
                    },
                });
            }

            tagConnections.push({ id: tag.id });
        } catch (tagError) {
            void tagError;
            logger.error('Error processing tag');
        }
    }

    const errorItem = await prisma.errorItem.create({
        data: {
            userId: userId,
            subjectId: subjectId || undefined,
            originalImageUrl: `data:${mimeType};base64,${imageBase64}`,
            ocrText: questionText || null,
            questionText: questionText || null,
            answerText: answerText || null,
            analysis: analysis || null,
            knowledgePoints: JSON.stringify(tagNames),
            gradeSemester: finalGradeSemester,
            paperLevel: null,
            errorType: errorType || null,
            source: source || 'Openclaw',
            masteryLevel: 0,
            tags: {
                connect: tagConnections,
            },
        },
        include: {
            tags: true,
            subject: true,
        },
    });

    return errorItem;
}

export async function POST(req: Request) {
    logger.info('POST /api/openclaw/batch-upload called');

    // Legacy integrations must use the same live, Turnstile-authenticated session
    // as the site. API keys and body credentials are no longer alternate logins.
    let identity: { id: string; role: string };
    try { identity = await requireUser(req); assertSameOrigin(req); }
    catch (error) { return aiErrorResponse(error); }
    try {
        const requestData = await req.json();
        const dbUser = await prisma.user.findUnique({ where: { id: identity.id } });
        if (!dbUser) return aiErrorResponse(new AIRequestError(401, "Authentication required"));
        if (requestData.userEmail && requestData.userEmail !== dbUser.email)
            return aiErrorResponse(new AIRequestError(403, "Cross-account upload denied"));
        const subjectId = typeof requestData.subjectId === "string" ? requestData.subjectId : undefined;
        if (subjectId && !await prisma.subject.findFirst({ where: { id: subjectId, userId: identity.id } }))
            return aiErrorResponse(new AIRequestError(403, "Subject access denied"));

        // 获取图片数组
        const { images } = requestData;

        // 验证图片数组
        if (!images || !Array.isArray(images) || images.length === 0) {
            return createErrorResponse(
                '未提供图片数据',
                400,
                ErrorCode.BAD_REQUEST,
                'Missing images array'
            );
        }

        // 验证图片数量
        if (images.length > MAX_IMAGES) {
            return createErrorResponse(
                `图片数量超过限制: 最多${MAX_IMAGES}张`,
                400,
                ErrorCode.BAD_REQUEST,
                `Maximum ${MAX_IMAGES} images allowed`
            );
        }

        const timeout = parseInt(process.env.OPENCLAW_TIMEOUT || '30000', 10);
        const singleImageTimeout = Math.min(3000, timeout / images.length);
        const results: Array<{
            success: boolean;
            index: number;
            errorItemId?: string;
            error?: string;
        }> = [];

        for (let i = 0; i < images.length; i++) {
            const imageData = images[i] as ImageData;
            const { base64, mimeType, filename } = imageData;

            const validation = validateImage(base64, filename);
            if (!validation.valid) {
                logger.warn({ index: i, filename, error: validation.error }, 'Image validation failed');
                results.push({
                    success: false,
                    index: i,
                    error: validation.error,
                });
                continue;
            }

            const openclawResponse = await callOpenclawAgent(base64, mimeType, singleImageTimeout);

            if (!openclawResponse.success || !openclawResponse.data) {
                logger.error({ index: i }, 'Openclaw recognition failed');
                results.push({
                    success: false,
                    index: i,
                    error: '识别服务未能完成请求',
                });
                continue;
            }

            try {
                const errorItem = await createErrorItem(
                    dbUser.id,
                    base64,
                    mimeType,
                    openclawResponse.data,
                    subjectId
                );

                results.push({
                    success: true,
                    index: i,
                    errorItemId: errorItem.id,
                });

                logger.info({ index: i, errorItemId: errorItem.id }, 'Error item created successfully');
            } catch {
                logger.error({ index: i }, 'Failed to create error item');
                results.push({
                    success: false,
                    index: i,
                    error: '数据库写入失败',
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        logger.info({ 
            total: results.length, 
            success: successCount, 
            failed: failCount 
        }, 'Batch upload completed');

        const statusCode = failCount === 0 ? 201 : 207;

        return NextResponse.json({
            success: failCount === 0,
            total: results.length,
            successCount,
            failCount,
            results,
        }, { status: statusCode });
    } catch {
        logger.error('Batch upload error');
        return createErrorResponse('批量上传失败', 500, ErrorCode.INTERNAL_ERROR, 'Batch upload failed');
    }
}
