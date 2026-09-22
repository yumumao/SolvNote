// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), fetch: vi.fn(), get: vi.fn(), log: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.get }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.log, info: mocks.log, warn: mocks.log }) }));
vi.mock('@/lib/ai-url', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/ai-url')>(), safeAIFetch: mocks.fetch }));
import * as route from '@/app/api/ai/models/route';
const request = (body: unknown, headers: Record<string, string> = {}) => new Request('https://app.example.com/api/ai/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const payload = { provider: 'openai', apiKey: 'fixture-request-key', baseUrl: 'https://api.example.com/v1' };
beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch);
    mocks.session.mockResolvedValue({ user: { id: 'u1', role: 'admin' } });
    mocks.user.mockResolvedValue({ id: 'u1', role: 'admin', isActive: true });
    mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: 'demo', owned_by: 'Example' }] }));
    mocks.get.mockReturnValue({ openai: { instances: [{ id: 'one', name: 'One', apiKey: 'fixture-stored-key', baseUrl: payload.baseUrl, model: 'demo' }] }, gemini: { apiKey: 'fixture-gemini-key', baseUrl: '' } });
});
describe('/api/ai/models POST', () => {
    it('retires GET and never processes query credentials', async () => {
        const response = await route.GET(new Request('https://app.example.com/api/ai/models?apiKey=fixture-query-key'));
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('requires a logged-in admin before outbound work', async () => {
        mocks.session.mockResolvedValue(null);
        expect((await route.POST(request(payload))).status).toBe(401);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each([{ id: 'u1', role: 'user', isActive: true }, { id: 'u1', role: 'admin', isActive: false }, null])('checks live DB authorization: %j', async (user) => {
        mocks.user.mockResolvedValue(user);
        expect((await route.POST(request(payload))).status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('rejects browser cross-origin POSTs', async () => {
        expect((await route.POST(request(payload, { Origin: 'https://evil.example.com' }))).status).toBe(403);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('queries OpenAI models with credentials in headers, not URLs', async () => {
        const response = await route.POST(request(payload));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ models: [{ id: 'demo', name: 'demo', owned_by: 'Example' }] });
        const [url, init] = mocks.fetch.mock.calls[0];
        expect(url).toBe('https://api.example.com/v1/models');
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-request-key');
        expect(response.headers.get('cache-control')).toContain('no-store');
    });
    it('uses the Gemini API key header and normalizes model names', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ models: [{ name: 'models/gemini-demo' }] }));
        const response = await route.POST(request({ provider: 'gemini', apiKey: payload.apiKey }));
        expect(await response.json()).toEqual({ models: [{ id: 'gemini-demo', name: 'gemini-demo', owned_by: 'Google' }] });
        const [url, init] = mocks.fetch.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
        expect(new Headers(init.headers).get('x-goog-api-key')).toBe(payload.apiKey);
        expect(url).not.toContain('key=');
    });
    it('resolves masks only against a uniquely matched stored endpoint', async () => {
        const response = await route.POST(request({ ...payload, apiKey: '********', model: 'demo' }));
        expect(response.status).toBe(200);
        expect(new Headers(mocks.fetch.mock.calls[0][1].headers).get('authorization')).toBe('Bearer fixture-stored-key');
    });
    it('never sends a masked stored key to a changed URL', async () => {
        expect((await route.POST(request({ ...payload, apiKey: '********', baseUrl: 'https://evil.example.com/v1' }))).status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each([{ ...payload, provider: 'unknown' }, { ...payload, headers: { host: 'internal' } }, { ...payload, apiKey: '' }])('rejects invalid body case %#', async (body) => {
        expect((await route.POST(request(body))).status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('rejects oversized JSON before outbound work', async () => {
        expect((await route.POST(request({ ...payload, apiKey: 'x'.repeat(70000) }))).status).toBe(413);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it.each(['throw', 'http'])('does not return or log raw provider errors (%s)', async (failure) => {
        if (failure === 'throw') mocks.fetch.mockRejectedValue(new Error('fixture-leaked-key'));
        else mocks.fetch.mockResolvedValue(new Response('fixture-leaked-key', { status: 401 }));
        const response = await route.POST(request(payload));
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain('fixture-leaked-key');
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('fixture-leaked-key');
    });
});

describe('/api/ai/models guarded transport failure boundary', () => {
    it('turns SSRF denial into a safe 400 rather than provider success', async () => {
        const { AIUrlError } = await import('@/lib/ai-url');
        mocks.fetch.mockRejectedValue(new AIUrlError());
        const response = await route.POST(request(payload));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'Invalid AI endpoint' });
    });
    it('fails closed for multiple matching masked OpenAI instances', async () => {
        mocks.get.mockReturnValue({ openai: { instances: [
            { id: 'one', apiKey: 'fixture-one', baseUrl: payload.baseUrl, model: 'demo' },
            { id: 'two', apiKey: 'fixture-two', baseUrl: payload.baseUrl, model: 'demo' },
        ] } });
        const response = await route.POST(request({ ...payload, apiKey: '********' }));
        expect(response.status).toBe(400); expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('filters echoed credentials from upstream model metadata', async () => {
        mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: payload.apiKey }] }));
        const response = await route.POST(request(payload));
        expect(await response.json()).toEqual({ models: [] });
    });
});
