import { z } from 'zod';
import { AIRequestError, DEFAULT_GEMINI_URL, DEFAULT_OPENAI_URL, aiErrorResponse, aiJson, assertSameOrigin, readAIJson, requireAdmin, resolveLegacyAIKey } from '@/lib/ai-access';
import { AIUrlError, safeAIFetch } from '@/lib/ai-url';

export const dynamic = 'force-dynamic';
// Synthetic built-in arithmetic image, never a user asset. Probes bypass legacy SDK loggers.
const TEST_IMAGE_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABkAMgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2aiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACobu5js7SW5lDFIkLsEXJIA6AdzU1QXpuxZTfYVha62HyhOxCbu24gE4+lAEOm6kmorPiCa3ltpfKmhm27kbarfwkg5VlPBPWrAuYXgeaOQSohYMY/n5UkMOO4IIx1yMVQ0XT57XS3tr1EWaRmaWSK4Z2lZurltqkEnPAHAAx04ZpegnR9MurW0vJjNPJNIksrvIIy7u6/KzHpu5P8WMnk0ATabrEeozz25tbi1ngRJGinC7tr52n5WOM7W4OCMcjpVy5uEtbWW5k3bIULttUscAZOAOprL0fS7m2vL+7uobS2a9Cb4bUlkLjdukJKj5m3AHjog5NS6NoNtonnfZ33edt3fuIY+mf+eaLnr3z7d6AJ9N1NNSSbEE1vLby+VLDMF3I21WH3SR91lPB71dqpYWYtEmyoDzTySud27dluOcD+EKMdsYycZNugAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==';
const TEST_IMAGE_MIME = 'image/jpeg';
const inputSchema = z.object({
    provider: z.enum(['openai', 'gemini', 'azure']),
    apiKey: z.string().min(1).max(8192).regex(/^[^\r\n\0]+$/),
    baseUrl: z.string().max(2048).optional(), endpoint: z.string().max(2048).optional(),
    model: z.string().max(256).optional(), instanceId: z.string().max(128).optional(),
    deploymentName: z.string().max(256).optional(), apiVersion: z.string().max(64).optional(),
    language: z.enum(['zh', 'en']).optional(),
}).strict();
export type AITestRequest = z.infer<typeof inputSchema>;
export interface AITestResponse {
    success: boolean;
    textSupport: boolean;
    visionSupport: boolean;
    textError?: string;
    visionError?: string;
    modelInfo?: string;
}
function statusCode(status: number): string {
    if (status === 401) return 'AI_AUTH_ERROR';
    if (status === 403) return 'AI_PERMISSION_DENIED';
    if (status === 404) return 'AI_NOT_FOUND';
    if (status === 408 || status === 504) return 'AI_TIMEOUT_ERROR';
    if (status === 429) return 'AI_QUOTA_EXCEEDED';
    if (status >= 500) return 'AI_SERVICE_UNAVAILABLE';
    return 'AI_RESPONSE_ERROR';
}
const chatResponse = z.object({ choices: z.array(z.object({ message: z.object({ content: z.union([
    z.string(), z.array(z.object({ text: z.string().optional() })),
]).nullable().optional() }) })) });
const geminiResponse = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional() })) });

type ProbeResult = { ok: boolean; error?: string; capabilityRejected?: boolean };
export async function POST(request: Request) {
    try {
        await requireAdmin(request);
        assertSameOrigin(request);
        const parsed = inputSchema.safeParse(await readAIJson(request));
        if (!parsed.success) throw new AIRequestError(400, 'Invalid test configuration');
        const input = parsed.data;
        if (input.provider === 'azure' && (!input.endpoint || !input.deploymentName)) {
            throw new AIRequestError(400, 'Azure endpoint and deployment are required');
        }
        const apiKey = await resolveLegacyAIKey(input);
        const baseUrl = input.provider === 'azure' ? input.endpoint! : (input.baseUrl || (input.provider === 'gemini' ? DEFAULT_GEMINI_URL : DEFAULT_OPENAI_URL));
        let base: URL;
        try { base = new URL(baseUrl); } catch { throw new AIRequestError(400, 'Invalid AI endpoint'); }
        if (base.username || base.password || base.search || base.hash) throw new AIRequestError(400, 'Invalid AI endpoint');
        const root = base.href.replace(/\/+$/, '');
        const model = input.model || (input.provider === 'gemini' ? 'gemini-2.0-flash' : input.provider === 'azure' ? input.deploymentName! : 'gpt-4o');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let url: string;
        if (input.provider === 'gemini') {
            url = `${root.endsWith('/v1beta') ? root : `${root}/v1beta`}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
            headers['x-goog-api-key'] = apiKey;
        } else if (input.provider === 'azure') {
            url = `${root}/openai/deployments/${encodeURIComponent(input.deploymentName!)}/chat/completions?api-version=${encodeURIComponent(input.apiVersion || '2024-02-15-preview')}`;
            headers['api-key'] = apiKey;
        } else {
            url = `${root}/chat/completions`;
            headers.Authorization = `Bearer ${apiKey}`;
        }
        // One shared deadline, at most two small calls. Never retry auth/quota/network errors.
        const signal = AbortSignal.timeout(20000);
        const probe = async (vision: boolean): Promise<ProbeResult> => {
            const prompt = vision ? 'Briefly describe the arithmetic in this image.' : 'Reply with OK.';
            const body = input.provider === 'gemini'
                ? { contents: [{ role: 'user', parts: [{ text: prompt }, ...(vision ? [{ inlineData: { mimeType: TEST_IMAGE_MIME, data: TEST_IMAGE_BASE64 } }] : [])] }], generationConfig: { maxOutputTokens: 128 } }
                : { model, messages: [{ role: 'user', content: vision ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${TEST_IMAGE_MIME};base64,${TEST_IMAGE_BASE64}` } }] : prompt }], max_tokens: 128 };
            try {
                const response = await safeAIFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
                if (!response.ok) return { ok: false, error: statusCode(response.status), capabilityRejected: [400, 415, 422].includes(response.status) };
                const json: unknown = await response.json();
                let ok: boolean;
                if (input.provider === 'gemini') {
                    const data = geminiResponse.safeParse(json);
                    ok = data.success && data.data.candidates.some(candidate => candidate.content?.parts.some(part => part.text?.trim()));
                } else {
                    const data = chatResponse.safeParse(json);
                    ok = data.success && data.data.choices.some(choice => typeof choice.message.content === 'string'
                        ? !!choice.message.content.trim() : choice.message.content?.some(part => part.text?.trim()));
                }
                return { ok, error: ok ? undefined : 'AI_RESPONSE_ERROR' };
            } catch (error) {
                if (error instanceof AIUrlError) throw error;
                return { ok: false, error: signal.aborted ? 'AI_TIMEOUT_ERROR' : 'AI_CONNECTION_FAILED' };
            }
        };
        const vision = await probe(true);
        const text = vision.ok ? vision : vision.capabilityRejected ? await probe(false) : vision;
        const response: AITestResponse = {
            success: text.ok, textSupport: text.ok, visionSupport: vision.ok,
            textError: text.ok ? undefined : text.error,
            visionError: vision.ok ? undefined : vision.capabilityRejected ? 'VISION_NOT_SUPPORTED' : vision.error,
            modelInfo: model.includes(apiKey) ? undefined : model,
        };
        return aiJson(response);
    } catch (error) {
        if (error instanceof AIUrlError) return aiJson({ error: 'Invalid AI endpoint' }, 400);
        return aiErrorResponse(error, 502);
    }
}
