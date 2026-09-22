import { z } from 'zod';
import { AIRequestError, DEFAULT_GEMINI_URL, DEFAULT_OPENAI_URL, aiErrorResponse, aiJson, assertSameOrigin, readAIJson, requireAdmin, resolveLegacyAIKey } from '@/lib/ai-access';
import { AIUrlError, safeAIFetch } from '@/lib/ai-url';

export const dynamic = 'force-dynamic';
const inputSchema = z.object({
    provider: z.enum(['openai', 'gemini']),
    apiKey: z.string().min(1).max(8192).regex(/^[^\r\n\0]+$/),
    baseUrl: z.string().max(2048).optional(),
    instanceId: z.string().min(1).max(128).optional(),
    model: z.string().max(256).optional(),
}).strict();
const modelSchema = z.object({ id: z.string().min(1).max(256), owned_by: z.string().max(256).optional() });
const geminiModelSchema = z.object({ name: z.string().min(1).max(256) });

/** Explicitly retire the old query-secret API. No authentication or outbound work on GET. */
export async function GET(_req?: Request) {
    void _req;
    const response = aiJson({ error: 'Use POST with a JSON body' }, 405);
    response.headers.set('Allow', 'POST');
    return response;
}

export async function POST(req: Request) {
    try {
        await requireAdmin(req);
        assertSameOrigin(req);
        const parsed = inputSchema.safeParse(await readAIJson(req));
        if (!parsed.success) throw new AIRequestError(400, 'Invalid model request');
        const input = parsed.data;
        const apiKey = await resolveLegacyAIKey(input);
        const fallback = input.provider === 'gemini' ? DEFAULT_GEMINI_URL : DEFAULT_OPENAI_URL;
        let base: URL;
        try { base = new URL(input.baseUrl || fallback); } catch { throw new AIRequestError(400, 'Invalid AI endpoint'); }
        if (base.username || base.password || base.search || base.hash) throw new AIRequestError(400, 'Invalid AI endpoint');
        const root = base.href.replace(/\/+$/, '');
        const url = input.provider === 'gemini'
            ? `${root.endsWith('/v1beta') ? root : `${root}/v1beta`}/models`
            : `${root}/models`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (input.provider === 'gemini') headers['x-goog-api-key'] = apiKey;
        else headers.Authorization = `Bearer ${apiKey}`;
        const response = await safeAIFetch(url, { headers, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new AIRequestError(502, 'Unable to retrieve models');
        const data = await response.json();
        const models = input.provider === 'gemini'
            ? z.object({ models: z.array(geminiModelSchema).max(5000).default([]) }).parse(data).models.map(model => {
                const id = model.name.replace(/^models\//, '');
                return { id, name: id, owned_by: 'Google' };
            })
            : z.object({ data: z.array(modelSchema).max(5000).default([]) }).parse(data).data.map(model => ({ id: model.id, name: model.id, owned_by: model.owned_by }));
        // A misconfigured/malicious upstream can echo request credentials in otherwise valid fields.
        const safeModels = models.filter(model => !JSON.stringify(model).includes(apiKey));
        return aiJson({ models: safeModels });
    } catch (error) {
        if (error instanceof AIUrlError) return aiJson({ error: 'Invalid AI endpoint' }, 400);
        return aiErrorResponse(error, 502);
    }
}
