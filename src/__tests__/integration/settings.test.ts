// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), get: vi.fn(), update: vi.fn(), configRow: vi.fn(), log: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, aiConfiguration: { findUnique: mocks.configRow } } }));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.get, updateAppConfig: mocks.update }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.log, info: mocks.log, warn: mocks.log }) }));
import { GET, POST } from '@/app/api/settings/route';

const fixture = () => ({
    aiProvider: 'openai',
    openai: { activeInstanceId: 'one', instances: [{ id: 'one', name: 'One', apiKey: 'fixture-openai-secret', baseUrl: 'https://api.example.com/v1', model: 'demo' }] },
    gemini: { apiKey: 'fixture-gemini-secret', baseUrl: '', model: 'demo' },
    azure: { apiKey: 'fixture-azure-secret', endpoint: 'https://azure.example.com', deploymentName: 'demo' },
    prompts: { analyze: 'private admin instruction', similar: '' }, timeouts: { analyze: 180000 },
    internalToken: 'fixture-internal-secret',
});
function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request('https://app.example.com/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: 'u1', role: 'admin' } });
    mocks.user.mockResolvedValue({ id: 'u1', role: 'admin', isActive: true, expiresAt: null, sessionVersion: 0, mustChangePassword: false });
    mocks.configRow.mockResolvedValue(null);
    mocks.get.mockImplementation(fixture);
    mocks.update.mockImplementation((patch) => ({ ...fixture(), ...patch }));
});

describe('/api/settings security', () => {
    it('requires authentication before reading settings', async () => {
        mocks.session.mockResolvedValue(null);
        expect((await GET(new Request('https://app.example.com/api/settings', { method: 'GET' }))).status).toBe(401);
        expect(mocks.get).not.toHaveBeenCalled();
    });
    it.each([null, { id: 'u1', role: 'admin', isActive: false }])('rejects deleted/inactive users: %j', async (user) => {
        mocks.user.mockResolvedValue(user);
        expect((await GET(new Request('https://app.example.com/api/settings', { method: 'GET' }))).status).toBe(403);
        expect(mocks.get).not.toHaveBeenCalled();
    });
    it('uses current DB role and only exposes the minimal nonadmin subset', async () => {
        mocks.user.mockResolvedValue({ id: 'u1', role: 'user', isActive: true, expiresAt: null, sessionVersion: 0, mustChangePassword: false });
        const response = await GET(new Request('https://app.example.com/api/settings', { method: 'GET' }));
        expect(await response.json()).toEqual({ timeouts: { analyze: 180000 } });
        expect(response.headers.get('cache-control')).toContain('no-store');
    });
    it('masks every provider key and excludes unknown settings for admins without mutating the config', async () => {
        const source = fixture(); mocks.get.mockReturnValue(source);
        const response = await GET(new Request('https://app.example.com/api/settings', { method: 'GET' })); const data = await response.json();
        expect(data.openai.instances[0].apiKey).toBe('********');
        expect(data.gemini.apiKey).toBe('********');
        expect(data.azure.apiKey).toBe('********');
        expect(data.prompts.analyze).toBe('private admin instruction');
        expect(JSON.stringify(data)).not.toContain('fixture-');
        expect(data.internalToken).toBeUndefined();
        expect(source.azure.apiKey).toBe('fixture-azure-secret');
        expect(response.headers.get('cache-control')).toContain('no-store');
    });
    it('blocks a stale JWT admin from writing', async () => {
        mocks.user.mockResolvedValue({ id: 'u1', role: 'user', isActive: true, expiresAt: null, sessionVersion: 0, mustChangePassword: false });
        expect((await POST(post({ timeouts: { analyze: 60000 } }))).status).toBe(403);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each<Record<string, string>>([{ Origin: 'https://evil.example.com' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }])('blocks cross-origin writes: %j', async (headers) => {
        expect((await POST(post({}, headers))).status).toBe(403);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('preserves all masked keys by instance ID and masks the POST response', async () => {
        const patch = fixture();
        Reflect.deleteProperty(patch, 'internalToken');
        patch.openai.instances[0].apiKey = '********'; patch.gemini.apiKey = '********'; patch.azure.apiKey = '********';
        const response = await POST(post(patch, { Origin: 'https://app.example.com', 'Sec-Fetch-Site': 'same-origin' }));
        expect(response.status).toBe(200);
        const saved = mocks.update.mock.calls[0][0];
        expect(saved.openai.instances[0].apiKey).toBe('fixture-openai-secret');
        expect(saved.gemini.apiKey).toBe('fixture-gemini-secret');
        expect(saved.azure.apiKey).toBe('fixture-azure-secret');
        expect(JSON.stringify(await response.json())).not.toContain('fixture-');
    });
    it('accepts partial preference writes', async () => {
        const response = await POST(post({ prompts: { similar: 'new' }, timeouts: { analyze: 60000 } }));
        expect(response.status).toBe(200);
        expect(mocks.update).toHaveBeenCalledWith({ prompts: { similar: 'new' }, timeouts: { analyze: 60000 } });
    });
    it('does not save mask literals for an unknown instance', async () => {
        const instance = { ...fixture().openai.instances[0], id: 'unknown', apiKey: '********' };
        expect((await POST(post({ openai: { instances: [instance] } }))).status).toBe(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each([
        { proxy: 'https://evil.example.com' }, { gemini: { headers: { authorization: 'danger' } } },
        { timeouts: { analyze: -1 } },
        { openai: { instances: [fixture().openai.instances[0], fixture().openai.instances[0]] } },
        { prompts: { analyze: 'x'.repeat(20000) } },
    ])('rejects unknown keys, invalid types and oversized fields case %#', async (body) => {
        expect((await POST(post(body))).status).toBe(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('rejects prototype pollution without echoing the body', async () => {
        const request = new Request('https://app.example.com/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"__proto__":{"polluted":true}}' });
        expect((await POST(request)).status).toBe(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each<Record<string, string>>([{}, { 'Content-Length': '1' }])('limits actual body bytes independently of Content-Length: %j', async (headers) => {
        expect((await POST(post({ prompts: { analyze: 'x'.repeat(70000) } }, headers))).status).toBe(413);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('returns a safe error for malformed JSON', async () => {
        const response = await POST(new Request('https://app.example.com/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
        expect(response.status).toBe(400);
    });
    it('does not expose or log backend error details', async () => {
        mocks.update.mockImplementation(() => { throw new Error('fixture-secret-backend-detail'); });
        const response = await POST(post({ timeouts: { analyze: 60000 } }));
        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain('fixture-secret');
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('fixture-secret');
    });
});

describe('/api/settings hostile configuration regression', () => {
    it('redacts credentials embedded in legacy endpoint URLs', async () => {
        const source = fixture();
        source.openai.instances[0].baseUrl = 'https://user:fixture-url-password@api.example.com/v1?apiKey=fixture-url-key#fixture-fragment';
        mocks.get.mockReturnValue(source);
        const response = await GET(new Request('https://app.example.com/api/settings', { method: 'GET' }));
        const data = await response.json();
        expect(data.openai.instances[0].baseUrl).toBe('https://api.example.com/v1');
        expect(JSON.stringify(data)).not.toContain('fixture-');
    });
    it.each(['text/plain', 'application/x-www-form-urlencoded'])('rejects CSRF-friendly content types: %s', async (type) => {
        expect((await POST(post({ timeouts: { analyze: 60000 } }, { 'Content-Type': type }))).status).toBe(415);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('rejects missing Azure/Gemini keys behind a mask', async () => {
        mocks.get.mockReturnValue({ aiProvider: 'azure' });
        expect((await POST(post({ azure: { apiKey: '********' } }))).status).toBe(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('accepts deliberate key clearing without storing the mask', async () => {
        expect((await POST(post({ azure: { apiKey: '' } }))).status).toBe(200);
        expect(mocks.update.mock.calls[0][0]).toEqual({ azure: { apiKey: '' } });
    });
});


describe('/api/settings after portable AI configuration migration', () => {
    beforeEach(() => {
        mocks.configRow.mockResolvedValue({ id: 'site' });
    });
    it.each([
        { aiProvider: 'openai' },
        { openai: {} },
        { gemini: {} },
        { azure: {} },
        { openai: { activeInstanceId: 'one' } },
        { azure: { apiKey: '********' } },
        { gemini: { apiKey: '' } },
        // Presence, not truthiness or successful schema parsing, is the guard.
        { aiProvider: null }, { openai: null }, { gemini: null }, { azure: null },
    ])('rejects every legacy AI patch as a whole without reading legacy config: case %#', async legacy => {
        const response = await POST(post({
            ...legacy, prompts: { similar: 'must not be partially saved' },
            timeouts: { analyze: 60000 },
        }));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: 'AI configuration is managed at /admin/ai' });
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(mocks.configRow).toHaveBeenCalledExactlyOnceWith({ where: { id: 'site' }, select: { id: true } });
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.log).not.toHaveBeenCalled();
    });
    it('rejects even an unchanged masked legacy settings form after migration', async () => {
        const patch = fixture();
        Reflect.deleteProperty(patch, 'internalToken');
        patch.openai.instances[0].apiKey = '********';
        patch.gemini.apiKey = '********';
        patch.azure.apiKey = '********';
        expect((await POST(post(patch))).status).toBe(409);
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each([
        { prompts: { analyze: 'updated prompt', similar: '' } },
        { timeouts: { analyze: 60000 } },
        { timeouts: { analyze: 60000 } },
        { prompts: { similar: 'new' }, timeouts: { analyze: 60000 } },
    ])('continues to save non-AI preferences without requiring a migration lookup: case %#', async patch => {
        const response = await POST(post(patch));
        expect(response.status).toBe(200);
        expect(mocks.configRow).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith(patch);
        expect(JSON.stringify(await response.json())).not.toContain('fixture-');
    });
    it('still permits valid legacy connection writes before the configuration row exists', async () => {
        mocks.configRow.mockResolvedValue(null);
        const response = await POST(post({ azure: { apiKey: '********' } }));
        expect(response.status).toBe(200);
        expect(mocks.configRow).toHaveBeenCalledExactlyOnceWith({ where: { id: 'site' }, select: { id: true } });
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ azure: { apiKey: fixture().azure.apiKey } });
    });
    it('keeps normal schema validation when the portable configuration row does not exist', async () => {
        mocks.configRow.mockResolvedValue(null);
        expect((await POST(post({ azure: null }))).status).toBe(400);
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('fails closed with a safe response if the migration-state lookup fails', async () => {
        mocks.configRow.mockRejectedValue(new Error('fixture-private-database-detail'));
        const response = await POST(post({ aiProvider: 'openai' }));
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'Unable to process request' });
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.log).not.toHaveBeenCalled();
    });
    it.each(['anonymous', 'ordinary', 'inactive'] as const)(
        'checks %s authorization before querying the migration state', async role => {
            if (role === 'anonymous') mocks.session.mockResolvedValue(null);
            else mocks.user.mockResolvedValue({ id: 'u1', role: role === 'ordinary' ? 'user' : 'admin', isActive: role !== 'inactive', expiresAt: null, sessionVersion: 0, mustChangePassword: false });
            expect((await POST(post({ aiProvider: 'openai' }))).status).toBe(role === 'anonymous' ? 401 : 403);
            expect(mocks.configRow).not.toHaveBeenCalled();
            expect(mocks.get).not.toHaveBeenCalled();
            expect(mocks.update).not.toHaveBeenCalled();
        },
    );
    it('checks Origin before querying the migration state', async () => {
        expect((await POST(post({ azure: {} }, { Origin: 'https://foreign.example.com' }))).status).toBe(403);
        expect(mocks.configRow).not.toHaveBeenCalled();
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it('enforces the byte limit before querying migration state', async () => {
        expect((await POST(post({ openai: {}, prompts: { analyze: 'x'.repeat(70000) } }))).status).toBe(413);
        expect(mocks.configRow).not.toHaveBeenCalled();
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});

it("rejects the retired registration settings writer even for admins",async()=>{expect((await POST(post({allowRegistration:true}))).status).toBe(409);expect(mocks.update).not.toHaveBeenCalled();});
