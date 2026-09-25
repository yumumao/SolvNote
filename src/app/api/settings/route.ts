import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAppConfig, updateAppConfig, type AppConfig } from '@/lib/config';
import { AIRequestError, MASKED_AI_KEY, aiJson, aiErrorResponse, assertSameOrigin, readAIJson, requireAdmin, requireUser } from '@/lib/ai-access';

export const dynamic = 'force-dynamic';
const legacyAIFields = ['aiProvider', 'openai', 'gemini', 'azure'] as const;
const short = z.string().max(256);
const apiKey = z.string().max(8192);
const endpoint = z.string().max(2048);
const instance = z.object({
    id: z.string().min(1).max(128), name: z.string().max(120), apiKey,
    baseUrl: endpoint, model: short,
}).strict();
const settingsPatch = z.object({
    aiProvider: z.enum(['openai', 'gemini', 'azure']).optional(),
    allowRegistration: z.boolean().optional(),
    openai: z.object({
        instances: z.array(instance).max(10).refine(values => new Set(values.map(value => value.id)).size === values.length).optional(),
        activeInstanceId: z.string().max(128).optional(),
    }).strict().optional(),
    gemini: z.object({ apiKey: apiKey.optional(), baseUrl: endpoint.optional(), model: short.optional() }).strict().optional(),
    azure: z.object({
        apiKey: apiKey.optional(), endpoint: endpoint.optional(), deploymentName: short.optional(),
        apiVersion: z.string().max(64).optional(), model: short.optional(),
    }).strict().optional(),
    prompts: z.object({ analyze: z.string().max(16384).optional(), similar: z.string().max(16384).optional() }).strict().optional(),
    timeouts: z.object({ analyze: z.number().int().min(1000).max(600000).optional() }).strict().optional(),
}).strict();

function maskedKey(key?: string): string { return key ? MASKED_AI_KEY : ''; }
function displayUrl(value?: string): string {
    if (!value) return '';
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol)) return '';
        // Also protect credentials embedded in legacy endpoint configuration.
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        return url.href.replace(/\/$/, '');
    } catch { return ''; }
}

function publicSettings(config: AppConfig) {
    // Ordinary users need timeouts, not provider endpoints or administrator prompts.
    return { allowRegistration: config.allowRegistration !== false, timeouts: { analyze: config.timeouts?.analyze ?? 180000 } };
}
function adminSettings(config: AppConfig) {
    // Explicit projection prevents future or imported config fields becoming public by accident.
    return {
        ...publicSettings(config), aiProvider: config.aiProvider,
        prompts: { analyze: config.prompts?.analyze ?? '', similar: config.prompts?.similar ?? '' },
        openai: {
            activeInstanceId: config.openai?.activeInstanceId,
            instances: (config.openai?.instances ?? []).map(item => ({
                id: item.id, name: item.name, apiKey: maskedKey(item.apiKey), baseUrl: displayUrl(item.baseUrl), model: item.model,
            })),
        },
        gemini: { apiKey: maskedKey(config.gemini?.apiKey), baseUrl: displayUrl(config.gemini?.baseUrl), model: config.gemini?.model },
        azure: {
            apiKey: maskedKey(config.azure?.apiKey), endpoint: displayUrl(config.azure?.endpoint),
            deploymentName: config.azure?.deploymentName, apiVersion: config.azure?.apiVersion, model: config.azure?.model,
        },
    };
}
function preservedKey(incoming: string | undefined, current: string | undefined): string | undefined {
    if (incoming !== MASKED_AI_KEY) return incoming;
    if (!current || current === MASKED_AI_KEY) throw new AIRequestError(400, 'No existing key to preserve');
    return current;
}

export async function GET(req: Request) {
    try {
        const user = await requireUser(req);
        const config = getAppConfig();
        return aiJson(user.role === 'admin' ? adminSettings(config) : publicSettings(config));
    } catch (error) { return aiErrorResponse(error); }
}

export async function POST(req: Request) {
    try {
        await requireAdmin(req);
        assertSameOrigin(req);
        const input = await readAIJson(req);
        if (input && typeof input === 'object'
            && legacyAIFields.some(field => Object.prototype.hasOwnProperty.call(input, field))) {
            // Check existence only: never load/migrate AI config or read its
            // encrypted payload/key just to reject an obsolete settings form.
            const migrated = await prisma.aiConfiguration.findUnique({ where: { id: 'site' }, select: { id: true } });
            if (migrated) throw new AIRequestError(409, 'AI configuration is managed at /admin/ai');
        }
        const parsed = settingsPatch.safeParse(input);
        if (!parsed.success) throw new AIRequestError(400, 'Invalid settings');
        const body = parsed.data;
        const current = getAppConfig();
        if (body.gemini?.apiKey !== undefined) body.gemini.apiKey = preservedKey(body.gemini.apiKey, current.gemini?.apiKey);
        if (body.azure?.apiKey !== undefined) body.azure.apiKey = preservedKey(body.azure.apiKey, current.azure?.apiKey);
        if (body.openai?.instances) {
            body.openai.instances = body.openai.instances.map(item => ({
                ...item, apiKey: preservedKey(item.apiKey, current.openai?.instances?.find(original => original.id === item.id)?.apiKey) ?? '',
            }));
        }
        if (body.openai?.activeInstanceId) {
            const instances = body.openai.instances ?? current.openai?.instances ?? [];
            if (!instances.some(item => item.id === body.openai?.activeInstanceId)) throw new AIRequestError(400, 'Invalid active instance');
        }
        return aiJson(adminSettings(updateAppConfig(body)));
    } catch (error) { return aiErrorResponse(error); }
}
